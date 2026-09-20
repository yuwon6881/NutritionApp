using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record GoogleHealthBodyFatSyncStatus(
    bool Enabled,
    bool PermissionGranted,
    string State,
    int PendingCount,
    DateTime? LastSuccessfulSyncAt,
    long Revision,
    string? FailureCode = null,
    string? FailureMessage = null);

public sealed record GoogleHealthBodyFatSyncProcessResult(int Processed, int Succeeded, int Retried, int Failed, int Unknown);

public sealed record GoogleHealthBodyFatSyncRecoveryInput(Guid? BodyRecordId = null);

public sealed class GoogleHealthBodyFatSyncService(
    AppDb db,
    GoogleHealthService google,
    HttpClient http,
    ILogger<GoogleHealthBodyFatSyncService>? logger = null)
{
    public const string BodyFatScope = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly";
    private static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(2);

    public static DateTimeOffset MeasurementTimestamp(DateOnly date, string? timeZone)
    {
        TimeZoneInfo zone;
        try
        {
            zone = string.IsNullOrWhiteSpace(timeZone)
                ? TimeZoneInfo.Utc
                : TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            zone = TimeZoneInfo.Utc;
        }

        var local = DateTime.SpecifyKind(date.ToDateTime(new TimeOnly(12, 0)), DateTimeKind.Unspecified);
        var offset = zone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset);
    }

    public static GoogleHealthBodyFatDataPoint BuildDataPoint(DateOnly date, double percentage, string? timeZone)
        => new(
            percentage,
            MeasurementTimestamp(date, timeZone).ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture));

    public async Task QueueMutationAsync(BodyRecord? previous, BodyMutation mutation, long revision, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null) return;

        var work = await db.GoogleHealthBodyFatSyncWork.SingleOrDefaultAsync(x => x.BodyRecordId == mutation.Id, ct);
        var mapped = work is not null && !string.IsNullOrWhiteSpace(work.GoogleResourceName);
        var isDelete = mutation.Action == "delete";
        var requestedPercent = mutation.Data?.Measurements != null && mutation.Data.Measurements.TryGetValue("bodyFatPercent", out var val) ? val
            : isDelete ? previous?.Measurements.BodyFatPercent : null;

        // If no body fat percent was set or updated, ignore
        if (requestedPercent is null && !mapped) return;

        var qualifiesAsNew = previous is null && !isDelete && requestedPercent is not null;
        if (work is null && (!qualifiesAsNew || !CanDispatch(connection))) return;

        if (work is null)
        {
            work = new GoogleHealthBodyFatSyncWork
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                BodyRecordId = mutation.Id,
                GoogleIdHash = connection.GoogleIdHash,
                ConnectionGeneration = connection.ConnectionGeneration,
                ProcessingState = "pending"
            };
            db.GoogleHealthBodyFatSyncWork.Add(work);
        }

        work.DesiredRevision = revision;
        work.DesiredDate = mutation.Data?.Date ?? previous?.Date ?? DateOnly.FromDateTime(DateTime.UtcNow);
        work.DesiredBodyFatPercent = requestedPercent ?? 0;
        work.DesiredDeleted = isDelete || requestedPercent is null;
        work.GoogleIdHash = connection.GoogleIdHash;
        work.ConnectionGeneration = connection.ConnectionGeneration;
        work.UpdatedAt = DateTime.UtcNow;

        if ((isDelete || requestedPercent is null) && !mapped)
        {
            CancelWork(work);
            return;
        }

        if (!connection.BodyFatSyncEnabled || !CanDispatch(connection))
        {
            if (work.ProcessingState is "pending")
                CancelWork(work);
            return;
        }

        if (work.ProcessingState == "unknown") return;
        if (mapped || qualifiesAsNew)
        {
            work.ProcessingState = "pending";
            work.NextAttemptAt = DateTime.UtcNow;
            work.LeaseUntil = null;
            work.LeaseId = "";
            work.GoogleOperationName = "";
            work.LastErrorCategory = "";
            work.LastErrorMessage = "";
        }
    }

    public async Task<GoogleHealthBodyFatSyncStatus> SetPreferenceAsync(bool enabled, long expectedRevision, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        Validation.Require(connection is not null, "Connect Google Health before changing body fat synchronization.", 409);
        Validation.Require(connection!.BodyFatSyncRevision == expectedRevision, "Google Health settings changed on another device. Refresh and try again.", 409);
        Validation.Require(!enabled || HasBodyFatScope(connection), "Google Health did not grant the body fat permission. Reconnect and allow body fat synchronization.", 409);

        connection.BodyFatSyncEnabled = enabled;
        connection.BodyFatSyncRevision++;
        connection.Revision++;
        if (!enabled)
        {
            var pending = await db.GoogleHealthBodyFatSyncWork
                .Where(x => x.ProcessingState == "pending")
                .ToListAsync(ct);
            foreach (var work in pending) CancelWork(work);
        }

        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await GetStatusAsync(ct);
    }

    public async Task<GoogleHealthBodyFatSyncStatus> RecoverAsync(Guid? bodyRecordId, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        Validation.Require(connection is not null, "Connect Google Health before recovering body fat synchronization.", 409);
        Validation.Require(CanDispatch(connection!), "Enable body fat synchronization after granting the Google Health body fat permission.", 409);

        var query = db.GoogleHealthBodyFatSyncWork.Where(x => new[] { "unknown", "failed" }.Contains(x.ProcessingState));
        if (bodyRecordId is not null) query = query.Where(x => x.BodyRecordId == bodyRecordId.Value);
        var works = await query.ToListAsync(ct);
        foreach (var work in works)
        {
            work.ProcessingState = "pending";
            work.NextAttemptAt = DateTime.UtcNow;
            work.LeaseUntil = null;
            work.LeaseId = "";
            work.GoogleOperationName = "";
            work.LastErrorCategory = "";
            work.LastErrorMessage = "";
            work.RetryCount = 0;
            work.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await GetStatusAsync(ct);
    }

    public async Task<GoogleHealthBodyFatSyncStatus> GetStatusAsync(CancellationToken ct)
    {
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null)
            return new(false, false, "disabled", 0, null, 0);

        var work = await db.GoogleHealthBodyFatSyncWork.ToListAsync(ct);
        var pending = work.Count(x => x.ProcessingState is "pending" or "processing" or "awaiting_operation");
        var problem = work.Where(x => x.ProcessingState is "failed" or "unknown").OrderByDescending(x => x.UpdatedAt).FirstOrDefault();
        var state = !connection.BodyFatSyncEnabled ? "disabled"
            : connection.Status == "reconnect_required" ? "reconnect_required"
            : problem?.ProcessingState ?? (pending > 0 ? "pending" : "idle");
        return new(
            connection.BodyFatSyncEnabled,
            HasBodyFatScope(connection),
            state,
            pending,
            connection.BodyFatLastSuccessfulSyncAt,
            connection.BodyFatSyncRevision,
            problem?.LastErrorCategory,
            problem?.LastErrorMessage);
    }

    public async Task<GoogleHealthBodyFatSyncProcessResult> ProcessDueAsync(CancellationToken ct)
    {
        var started = DateTime.UtcNow;
        var deadline = started.AddSeconds(45);
        var candidates = await db.GoogleHealthBodyFatSyncWork.IgnoreQueryFilters()
            .Where(x => new[] { "pending", "awaiting_operation" }.Contains(x.ProcessingState)
                && x.NextAttemptAt <= started
                && (x.LeaseUntil == null || x.LeaseUntil < started))
            .OrderBy(x => x.NextAttemptAt)
            .ThenBy(x => x.CreatedAt)
            .Take(25)
            .Select(x => new { x.UserId, x.Id })
            .ToListAsync(ct);

        var processed = 0;
        var succeeded = 0;
        var retried = 0;
        var failed = 0;
        var unknown = 0;
        foreach (var candidate in candidates)
        {
            if (DateTime.UtcNow >= deadline) break;
            db.ChangeTracker.Clear();
            db.CurrentUser = candidate.UserId;
            var lease = await LeaseAsync(candidate.UserId, candidate.Id, ct);
            if (lease is null) continue;
            processed++;
            var result = await ProcessOneAsync(lease, ct);
            succeeded += result == "succeeded" ? 1 : 0;
            retried += result == "retry" ? 1 : 0;
            failed += result == "failed" ? 1 : 0;
            unknown += result == "unknown" ? 1 : 0;
        }

        if (processed > 0)
            logger?.LogInformation("Google Health body fat sync processed {Processed} records; succeeded={Succeeded}; retried={Retried}; failed={Failed}; unknown={Unknown}.", processed, succeeded, retried, failed, unknown);
        return new(processed, succeeded, retried, failed, unknown);
    }

    private async Task<BodyFatWorkLease?> LeaseAsync(Guid userId, Guid workId, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        db.CurrentUser = userId;
        var work = await db.GoogleHealthBodyFatSyncWork.SingleOrDefaultAsync(x => x.Id == workId, ct);
        if (work is null || work.ProcessingState is not ("pending" or "awaiting_operation") || work.NextAttemptAt > DateTime.UtcNow || work.LeaseUntil > DateTime.UtcNow)
            return null;
        var leaseId = Guid.NewGuid().ToString("N");
        work.ProcessingState = "processing";
        work.LeaseId = leaseId;
        work.LeaseUntil = DateTime.UtcNow.Add(LeaseDuration);
        work.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return new(userId, workId, leaseId, work.DesiredRevision, work.DesiredDate, work.DesiredBodyFatPercent, work.DesiredDeleted, work.GoogleResourceName, work.GoogleOperationName, work.ConnectionGeneration, work.GoogleIdHash);
    }

    private async Task<string> ProcessOneAsync(BodyFatWorkLease lease, CancellationToken ct)
    {
        try
        {
            db.ChangeTracker.Clear();
            db.CurrentUser = lease.UserId;
            var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
            var identityMatches = connection is not null
                && connection.ConnectionGeneration == lease.ConnectionGeneration
                && connection.GoogleIdHash == lease.GoogleIdHash;
            var canContinueSubmittedOperation = !string.IsNullOrWhiteSpace(lease.OperationName);
            if (!identityMatches || (!CanDispatch(connection!) && !canContinueSubmittedOperation))
            {
                await FinalizeAsync(lease, (work, _) => CancelWork(work), ct);
                return "failed";
            }

            var accessToken = await google.GetAccessTokenAsync(lease.UserId, BodyFatScope, ct);
            if (string.IsNullOrWhiteSpace(accessToken))
            {
                await FinalizeAsync(lease, (work, _) => RetryAuthentication(work), ct);
                return "retry";
            }

            GoogleHealthOperationResult result;
            if (!string.IsNullOrWhiteSpace(lease.OperationName))
                result = await GoogleHealthBodyFatProvider.PollAsync(http, accessToken, lease.OperationName, ct);
            else if (lease.Deleted)
                result = await GoogleHealthBodyFatProvider.DeleteAsync(http, accessToken, lease.ResourceName, ct);
            else if (!string.IsNullOrWhiteSpace(lease.ResourceName))
                result = await GoogleHealthBodyFatProvider.UpdateAsync(http, accessToken, lease.ResourceName, BuildDataPoint(lease.Date, lease.Percentage, await ProfileTimeZoneAsync(lease.UserId, ct)), ct);
            else
                result = await GoogleHealthBodyFatProvider.CreateAsync(http, accessToken, BuildDataPoint(lease.Date, lease.Percentage, await ProfileTimeZoneAsync(lease.UserId, ct)), ct);

            if (!result.Done)
            {
                await FinalizeAsync(lease, (work, _) =>
                {
                    work.ProcessingState = "awaiting_operation";
                    work.GoogleOperationName = result.OperationName ?? "";
                    work.NextAttemptAt = DateTime.UtcNow.AddSeconds(30);
                    work.LeaseUntil = null;
                    work.LeaseId = "";
                    work.UpdatedAt = DateTime.UtcNow;
                }, ct);
                return "retry";
            }

            if (!result.Success)
            {
                if (result.AuthenticationFailure)
                {
                    await google.MarkReconnectRequiredAsync(lease.UserId, ct);
                    await FinalizeAsync(lease, (work, _) => RetryAuthentication(work), ct);
                    return "retry";
                }
                if (result.UnknownCreate)
                {
                    await FinalizeAsync(lease, (work, _) => MarkUnknown(work), ct);
                    return "unknown";
                }
                if (result.Transient)
                {
                    await FinalizeAsync(lease, (work, _) => Retry(work, result.RetryAfter), ct);
                    return "retry";
                }
                await FinalizeAsync(lease, (work, _) => MarkFailed(work, result.ErrorCategory, result.ErrorMessage), ct);
                return "failed";
            }

            await FinalizeAsync(lease, (work, latest) =>
            {
                if (!string.IsNullOrWhiteSpace(result.ResourceName)) work.GoogleResourceName = result.ResourceName;
                work.GoogleOperationName = "";
                work.LastSuccessfulSyncAt = DateTime.UtcNow;
                work.LastErrorCategory = "";
                work.LastErrorMessage = "";
                work.RetryCount = 0;
                work.LeaseUntil = null;
                work.LeaseId = "";
                work.UpdatedAt = DateTime.UtcNow;
                if (latest is not null && latest.DesiredRevision != lease.DesiredRevision)
                {
                    work.ProcessingState = "pending";
                    work.NextAttemptAt = DateTime.UtcNow;
                }
                else
                {
                    work.ProcessingState = "succeeded";
                    work.NextAttemptAt = DateTime.MaxValue;
                }
            }, ct);
            await MarkConnectionSuccessAsync(lease.UserId, ct);
            return "succeeded";
        }
        catch (GoogleHealthBodyFatProviderException ex)
        {
            if (ex.UnknownCreate)
            {
                await FinalizeAsync(lease, (work, _) => MarkUnknown(work), ct);
                return "unknown";
            }
            if (ex.AuthenticationFailure)
                await google.MarkReconnectRequiredAsync(lease.UserId, ct);
            await FinalizeAsync(lease, (work, _) =>
            {
                if (ex.AuthenticationFailure)
                    RetryAuthentication(work);
                else if (ex.Transient) Retry(work, ex.RetryAfter);
                else MarkFailed(work, ex.Category, ex.Message);
            }, ct);
            return ex.AuthenticationFailure || ex.Transient ? "retry" : "failed";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            await FinalizeAsync(lease, (work, _) => Retry(work, null), ct);
            return "retry";
        }
    }

    private async Task FinalizeAsync(BodyFatWorkLease lease, Action<GoogleHealthBodyFatSyncWork, GoogleHealthBodyFatSyncWork?> update, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        db.CurrentUser = lease.UserId;
        await using var gate = await MutationLock.Acquire(db, lease.UserId, ct);
        var work = await db.GoogleHealthBodyFatSyncWork.SingleOrDefaultAsync(x => x.Id == lease.WorkId, ct);
        if (work is null || work.LeaseId != lease.LeaseId) return;
        var latest = work.DesiredRevision == lease.DesiredRevision ? null : work;
        update(work, latest);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task MarkConnectionSuccessAsync(Guid userId, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        db.CurrentUser = userId;
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null) return;
        connection.BodyFatLastSuccessfulSyncAt = DateTime.UtcNow;
        connection.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task<string?> ProfileTimeZoneAsync(Guid userId, CancellationToken ct)
        => await db.Users.Where(x => x.Id == userId).Select(x => x.ProfileJson).SingleOrDefaultAsync(ct) is { Length: > 0 } json
            ? Json.Read<Profile>(json).TimeZone
            : null;

    private static bool CanDispatch(GoogleHealthConnection connection)
        => connection.Status == "connected" && connection.BodyFatSyncEnabled && HasBodyFatScope(connection);

    private static bool HasBodyFatScope(GoogleHealthConnection connection)
    {
        try
        {
            var scopes = JsonSerializer.Deserialize<string[]>(connection.GrantedScopesJson, Json.Options) ?? [];
            return scopes.Contains(BodyFatScope, StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static void CancelWork(GoogleHealthBodyFatSyncWork work)
    {
        work.ProcessingState = "cancelled";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.GoogleOperationName = "";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static void RetryAuthentication(GoogleHealthBodyFatSyncWork work)
    {
        work.ProcessingState = "pending";
        work.NextAttemptAt = DateTime.UtcNow.AddHours(1);
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = "reconnect_required";
        work.LastErrorMessage = "Reconnect Google Health to resume body fat uploads.";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static void Retry(GoogleHealthBodyFatSyncWork work, TimeSpan? retryAfter)
    {
        work.RetryCount = Math.Min(work.RetryCount + 1, 8);
        var delay = retryAfter ?? TimeSpan.FromSeconds(Math.Min(3600, Math.Pow(2, work.RetryCount) * 15));
        work.ProcessingState = "pending";
        work.NextAttemptAt = DateTime.UtcNow.Add(delay);
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = "provider_unavailable";
        work.LastErrorMessage = "Google Health temporarily rejected the upload. It will retry automatically.";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static void MarkFailed(GoogleHealthBodyFatSyncWork work, string? category, string? message)
    {
        work.ProcessingState = "failed";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = category ?? "provider_validation";
        work.LastErrorMessage = message ?? "Google Health rejected this body fat upload.";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static void MarkUnknown(GoogleHealthBodyFatSyncWork work)
    {
        work.ProcessingState = "unknown";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = "upload_status_unknown";
        work.LastErrorMessage = "The create response was lost. Check Google Health for a copy before requesting another upload.";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private sealed record BodyFatWorkLease(Guid UserId, Guid WorkId, string LeaseId, long DesiredRevision, DateOnly Date, double Percentage, bool Deleted, string ResourceName, string OperationName, long ConnectionGeneration, string GoogleIdHash);
}

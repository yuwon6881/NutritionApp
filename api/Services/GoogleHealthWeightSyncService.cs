using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record GoogleHealthWeightDataPoint(long WeightGrams, string SampleTime, string? Notes = null);

public sealed record GoogleHealthWeightSyncStatus(
    bool Enabled,
    bool PermissionGranted,
    string State,
    int PendingCount,
    DateTime? LastSuccessfulSyncAt,
    long Revision,
    string? FailureCode = null,
    string? FailureMessage = null);

public sealed record GoogleHealthWeightSyncProcessResult(int Processed, int Succeeded, int Retried, int Failed, int Unknown);

public sealed record GoogleHealthWeightSyncRecoveryInput(Guid? WeightId = null);

public sealed class GoogleHealthWeightSyncService(
    AppDb db,
    GoogleHealthService google,
    HttpClient http,
    ILogger<GoogleHealthWeightSyncService>? logger = null)
{
    public const string WeightScope = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly";
    private static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(2);

    public static long ToGrams(double kilograms)
        => checked((long)Math.Round(kilograms * 1000, MidpointRounding.AwayFromZero));

    public static DateTimeOffset MeasurementTimestamp(DateOnly date, string? timeZone)
    {
        TimeZoneInfo zone;
        try
        {
            zone = string.IsNullOrWhiteSpace(timeZone)
                ? TimeZoneInfo.Utc
                : TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        }
        catch (TimeZoneNotFoundException)
        {
            zone = TimeZoneInfo.Utc;
        }
        catch (InvalidTimeZoneException)
        {
            zone = TimeZoneInfo.Utc;
        }

        var local = DateTime.SpecifyKind(date.ToDateTime(new TimeOnly(12, 0)), DateTimeKind.Unspecified);
        var offset = zone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset);
    }

    public static GoogleHealthWeightDataPoint BuildDataPoint(DateOnly date, double kilograms, string? timeZone)
        => new(
            ToGrams(kilograms),
            MeasurementTimestamp(date, timeZone).ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture));

    public async Task QueueMutationAsync(Weight? previous, Mutation operation, long revision, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null) return;

        var work = await db.GoogleHealthWeightSyncWork.SingleOrDefaultAsync(x => x.WeightId == operation.RecordId, ct);
        var mapped = work is not null && !string.IsNullOrWhiteSpace(work.GoogleResourceName);
        var qualifiesAsNew = previous is null && !operation.Delete;
        if (work is null && (!qualifiesAsNew || !CanDispatch(connection))) return;

        if (work is null)
        {
            work = new GoogleHealthWeightSyncWork
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                WeightId = operation.RecordId,
                GoogleIdHash = connection.GoogleIdHash,
                ConnectionGeneration = connection.ConnectionGeneration,
                ProcessingState = "pending"
            };
            db.GoogleHealthWeightSyncWork.Add(work);
        }

        var requested = operation.Delete
            ? previous ?? throw new DomainException("Weight is required.")
            : operation.Data.Deserialize<Weight>(Json.Options) ?? throw new DomainException("Weight is required.");
        work.DesiredRevision = revision;
        work.DesiredDate = requested.Date;
        work.DesiredKg = requested.Kg;
        work.DesiredDeleted = operation.Delete;
        work.GoogleIdHash = connection.GoogleIdHash;
        work.ConnectionGeneration = connection.ConnectionGeneration;
        work.UpdatedAt = DateTime.UtcNow;

        if (operation.Delete && !mapped)
        {
            CancelWork(work);
            return;
        }

        if (!connection.WeightSyncEnabled || !CanDispatch(connection))
        {
            // A request already sent to Google must finish so its server-generated
            // resource mapping is retained. New work is cancelled while disabled.
            if (work.ProcessingState is "pending")
                CancelWork(work);
            return;
        }

        // A lost create response is never retried implicitly: the user must acknowledge
        // the duplicate risk before asking for another create attempt.
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

    public async Task<GoogleHealthWeightSyncStatus> SetPreferenceAsync(bool enabled, long expectedRevision, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        Validation.Require(connection is not null, "Connect Google Health before changing weight synchronization.", 409);
        Validation.Require(connection!.WeightSyncRevision == expectedRevision, "Google Health settings changed on another device. Refresh and try again.", 409);
        Validation.Require(!enabled || HasWeightScope(connection), "Google Health did not grant the weight permission. Reconnect and allow weight synchronization.", 409);

        connection.WeightSyncEnabled = enabled;
        connection.WeightSyncRevision++;
        connection.Revision++;
        if (!enabled)
        {
            var pending = await db.GoogleHealthWeightSyncWork
                .Where(x => x.ProcessingState == "pending")
                .ToListAsync(ct);
            foreach (var work in pending) CancelWork(work);
        }

        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await GetStatusAsync(ct);
    }

    public async Task<GoogleHealthWeightSyncStatus> RecoverAsync(Guid? weightId, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        Validation.Require(connection is not null, "Connect Google Health before recovering weight synchronization.", 409);
        Validation.Require(CanDispatch(connection!), "Enable weight synchronization after granting the Google Health weight permission.", 409);

        var query = db.GoogleHealthWeightSyncWork.Where(x => new[] { "unknown", "failed" }.Contains(x.ProcessingState));
        if (weightId is not null) query = query.Where(x => x.WeightId == weightId.Value);
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

    public async Task<GoogleHealthWeightSyncStatus> GetStatusAsync(CancellationToken ct)
    {
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null)
            return new(false, false, "disabled", 0, null, 0);

        var work = await db.GoogleHealthWeightSyncWork.ToListAsync(ct);
        var pending = work.Count(x => x.ProcessingState is "pending" or "processing" or "awaiting_operation");
        var problem = work.Where(x => x.ProcessingState is "failed" or "unknown").OrderByDescending(x => x.UpdatedAt).FirstOrDefault();
        var state = !connection.WeightSyncEnabled ? "disabled"
            : connection.Status == "reconnect_required" ? "reconnect_required"
            : problem?.ProcessingState ?? (pending > 0 ? "pending" : "idle");
        return new(
            connection.WeightSyncEnabled,
            HasWeightScope(connection),
            state,
            pending,
            connection.WeightLastSuccessfulSyncAt,
            connection.WeightSyncRevision,
            problem?.LastErrorCategory,
            problem?.LastErrorMessage);
    }

    public async Task<GoogleHealthWeightSyncProcessResult> ProcessDueAsync(CancellationToken ct)
    {
        var started = DateTime.UtcNow;
        var deadline = started.AddSeconds(45);
        var candidates = await db.GoogleHealthWeightSyncWork.IgnoreQueryFilters()
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
            logger?.LogInformation("Google Health weight sync processed {Processed} records; succeeded={Succeeded}; retried={Retried}; failed={Failed}; unknown={Unknown}.", processed, succeeded, retried, failed, unknown);
        return new(processed, succeeded, retried, failed, unknown);
    }

    private async Task<WorkLease?> LeaseAsync(Guid userId, Guid workId, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        db.CurrentUser = userId;
        var work = await db.GoogleHealthWeightSyncWork.SingleOrDefaultAsync(x => x.Id == workId, ct);
        if (work is null || work.ProcessingState is not ("pending" or "awaiting_operation") || work.NextAttemptAt > DateTime.UtcNow || work.LeaseUntil > DateTime.UtcNow)
            return null;
        var leaseId = Guid.NewGuid().ToString("N");
        work.ProcessingState = "processing";
        work.LeaseId = leaseId;
        work.LeaseUntil = DateTime.UtcNow.Add(LeaseDuration);
        work.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return new(userId, workId, leaseId, work.DesiredRevision, work.DesiredDate, work.DesiredKg, work.DesiredDeleted, work.GoogleResourceName, work.GoogleOperationName, work.ConnectionGeneration, work.GoogleIdHash);
    }

    private async Task<string> ProcessOneAsync(WorkLease lease, CancellationToken ct)
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

            var accessToken = await google.GetAccessTokenAsync(lease.UserId, WeightScope, ct);
            if (string.IsNullOrWhiteSpace(accessToken))
            {
                await FinalizeAsync(lease, (work, _) => RetryAuthentication(work), ct);
                return "retry";
            }

            GoogleHealthOperationResult result;
            if (!string.IsNullOrWhiteSpace(lease.OperationName))
                result = await GoogleHealthWeightProvider.PollAsync(http, accessToken, lease.OperationName, ct);
            else if (lease.Deleted)
                result = await GoogleHealthWeightProvider.DeleteAsync(http, accessToken, lease.ResourceName, ct);
            else if (!string.IsNullOrWhiteSpace(lease.ResourceName))
                result = await GoogleHealthWeightProvider.UpdateAsync(http, accessToken, lease.ResourceName, BuildDataPoint(lease.Date, lease.Kg, await ProfileTimeZoneAsync(lease.UserId, ct)), ct);
            else
                result = await GoogleHealthWeightProvider.CreateAsync(http, accessToken, BuildDataPoint(lease.Date, lease.Kg, await ProfileTimeZoneAsync(lease.UserId, ct)), ct);

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
        catch (GoogleHealthWeightProviderException ex)
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

    private async Task FinalizeAsync(WorkLease lease, Action<GoogleHealthWeightSyncWork, GoogleHealthWeightSyncWork?> update, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        db.CurrentUser = lease.UserId;
        await using var gate = await MutationLock.Acquire(db, lease.UserId, ct);
        var work = await db.GoogleHealthWeightSyncWork.SingleOrDefaultAsync(x => x.Id == lease.WorkId, ct);
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
        connection.WeightLastSuccessfulSyncAt = DateTime.UtcNow;
        connection.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task<string?> ProfileTimeZoneAsync(Guid userId, CancellationToken ct)
        => await db.Users.Where(x => x.Id == userId).Select(x => x.ProfileJson).SingleOrDefaultAsync(ct) is { Length: > 0 } json
            ? Json.Read<Profile>(json).TimeZone
            : null;

    private static bool CanDispatch(GoogleHealthConnection connection)
        => connection.Status == "connected" && connection.WeightSyncEnabled && HasWeightScope(connection);

    private static bool HasWeightScope(GoogleHealthConnection connection)
    {
        try
        {
            var scopes = JsonSerializer.Deserialize<string[]>(connection.GrantedScopesJson, Json.Options) ?? [];
            return scopes.Contains(WeightScope, StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static void CancelWork(GoogleHealthWeightSyncWork work)
    {
        work.ProcessingState = "cancelled";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.GoogleOperationName = "";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static void RetryAuthentication(GoogleHealthWeightSyncWork work)
    {
        work.ProcessingState = "pending";
        work.NextAttemptAt = DateTime.UtcNow.AddHours(1);
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = "reconnect_required";
        work.LastErrorMessage = "Reconnect Google Health to resume weight uploads.";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static void Retry(GoogleHealthWeightSyncWork work, TimeSpan? retryAfter)
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

    private static void MarkFailed(GoogleHealthWeightSyncWork work, string? category, string? message)
    {
        work.ProcessingState = "failed";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = category ?? "provider_validation";
        work.LastErrorMessage = message ?? "Google Health rejected this weight upload.";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static void MarkUnknown(GoogleHealthWeightSyncWork work)
    {
        work.ProcessingState = "unknown";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = "upload_status_unknown";
        work.LastErrorMessage = "The create response was lost. Check Google Health for a copy before requesting another upload.";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private sealed record WorkLease(Guid UserId, Guid WorkId, string LeaseId, long DesiredRevision, DateOnly Date, double Kg, bool Deleted, string ResourceName, string OperationName, long ConnectionGeneration, string GoogleIdHash);
}

using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record GoogleHealthNutritionSyncStatus(
    bool Enabled,
    bool PermissionGranted,
    string State,
    int PendingCount,
    DateTime? LastSuccessfulSyncAt,
    long Revision,
    string? FailureCode = null,
    string? FailureMessage = null);

public sealed record GoogleHealthNutritionSyncProcessResult(int Processed, int Succeeded, int Retried, int Failed, int Unknown);

public sealed record GoogleHealthNutritionSyncRecoveryInput(Guid? EntryId = null);

public sealed class GoogleHealthNutritionSyncService(
    AppDb db,
    GoogleHealthService google,
    HttpClient http,
    ILogger<GoogleHealthNutritionSyncService>? logger = null)
{
    public const string NutritionScope = "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly";
    private static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(2);

    public static string InferMealType(string? time)
    {
        if (string.IsNullOrWhiteSpace(time) || !TimeOnly.TryParse(time, CultureInfo.InvariantCulture, out var t))
            return "MEAL_TYPE_UNSPECIFIED";
        return t.Hour switch
        {
            >= 5 and < 11 => "BREAKFAST",
            >= 11 and < 15 => "LUNCH",
            >= 15 and < 18 => "SNACK",
            _ => "DINNER"
        };
    }

    public static DateTimeOffset EntryTimestamp(DateOnly date, string? time, string? timeZone)
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

        var timeOnly = !string.IsNullOrWhiteSpace(time) && TimeOnly.TryParse(time, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : new TimeOnly(12, 0);

        var local = DateTime.SpecifyKind(date.ToDateTime(timeOnly), DateTimeKind.Unspecified);
        var offset = zone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset);
    }

    public static GoogleHealthNutritionDataPoint BuildDataPoint(
        DateOnly date, string? time, string name, double calories,
        double? protein, double? fat, double? carbs, double? fiber, string? timeZone)
    {
        var start = EntryTimestamp(date, time, timeZone);
        var end = start.AddMinutes(15);
        return new GoogleHealthNutritionDataPoint(
            start.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
            end.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
            name,
            InferMealType(time),
            calories,
            protein,
            fat,
            carbs,
            fiber);
    }

    public async Task QueueMutationAsync(DiaryEntry? previous, Mutation operation, long revision, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null) return;

        var work = await db.GoogleHealthNutritionSyncWork.SingleOrDefaultAsync(x => x.EntryId == operation.RecordId, ct);
        var mapped = work is not null && !string.IsNullOrWhiteSpace(work.GoogleResourceName);
        var qualifiesAsNew = previous is null && !operation.Delete;
        if (work is null && (!qualifiesAsNew || !CanDispatch(connection))) return;

        if (work is null)
        {
            work = new GoogleHealthNutritionSyncWork
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                EntryId = operation.RecordId,
                GoogleIdHash = connection.GoogleIdHash,
                ConnectionGeneration = connection.ConnectionGeneration,
                ProcessingState = "pending"
            };
            db.GoogleHealthNutritionSyncWork.Add(work);
        }

        var requested = operation.Delete
            ? previous ?? throw new DomainException("Diary entry is required.")
            : operation.Data.Deserialize<DiaryEntry>(Json.Options) ?? throw new DomainException("Diary entry is required.");

        work.DesiredRevision = revision;
        work.DesiredDate = requested.Date;
        work.DesiredTime = requested.Time;
        work.DesiredName = requested.Name;
        work.DesiredCalories = requested.Calories;
        work.DesiredProtein = requested.Protein;
        work.DesiredFat = requested.Fat;
        work.DesiredCarbs = requested.Carbs;
        work.DesiredFiber = requested.Fiber;
        work.DesiredDeleted = operation.Delete;
        work.GoogleIdHash = connection.GoogleIdHash;
        work.ConnectionGeneration = connection.ConnectionGeneration;
        work.UpdatedAt = DateTime.UtcNow;

        if (operation.Delete && !mapped)
        {
            CancelWork(work);
            return;
        }

        if (!connection.NutritionSyncEnabled || !CanDispatch(connection))
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

    public async Task<GoogleHealthNutritionSyncStatus> SetPreferenceAsync(bool enabled, long expectedRevision, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        Validation.Require(connection is not null, "Connect Google Health before changing nutrition synchronization.", 409);
        Validation.Require(connection!.NutritionSyncRevision == expectedRevision, "Google Health settings changed on another device. Refresh and try again.", 409);
        Validation.Require(!enabled || HasNutritionScope(connection), "Google Health did not grant the nutrition permission. Reconnect and allow nutrition synchronization.", 409);

        connection.NutritionSyncEnabled = enabled;
        connection.NutritionSyncRevision++;
        connection.Revision++;
        if (!enabled)
        {
            var pending = await db.GoogleHealthNutritionSyncWork
                .Where(x => x.ProcessingState == "pending")
                .ToListAsync(ct);
            foreach (var work in pending) CancelWork(work);
        }

        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return await GetStatusAsync(ct);
    }

    public async Task<GoogleHealthNutritionSyncStatus> RecoverAsync(Guid? entryId, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        Validation.Require(connection is not null, "Connect Google Health before recovering nutrition synchronization.", 409);
        Validation.Require(CanDispatch(connection!), "Enable nutrition synchronization after granting the Google Health nutrition permission.", 409);

        var query = db.GoogleHealthNutritionSyncWork.Where(x => new[] { "unknown", "failed" }.Contains(x.ProcessingState));
        if (entryId is not null) query = query.Where(x => x.EntryId == entryId.Value);
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

    public async Task<GoogleHealthNutritionSyncStatus> GetStatusAsync(CancellationToken ct)
    {
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null)
            return new(false, false, "disabled", 0, null, 0);

        var work = await db.GoogleHealthNutritionSyncWork.ToListAsync(ct);
        var pending = work.Count(x => x.ProcessingState is "pending" or "processing" or "awaiting_operation");
        var problem = work.Where(x => x.ProcessingState is "failed" or "unknown").OrderByDescending(x => x.UpdatedAt).FirstOrDefault();
        var state = !connection.NutritionSyncEnabled ? "disabled"
            : connection.Status == "reconnect_required" ? "reconnect_required"
            : problem?.ProcessingState ?? (pending > 0 ? "pending" : "idle");
        return new(
            connection.NutritionSyncEnabled,
            HasNutritionScope(connection),
            state,
            pending,
            connection.NutritionLastSuccessfulSyncAt,
            connection.NutritionSyncRevision,
            problem?.LastErrorCategory,
            problem?.LastErrorMessage);
    }

    /// Processes due uploads for every account, or for one account while its user is active.
    public async Task<GoogleHealthNutritionSyncProcessResult> ProcessDueAsync(CancellationToken ct, Guid? userId = null, TimeSpan? budget = null)
    {
        var started = DateTime.UtcNow;
        var deadline = started.Add(budget ?? GoogleHealthSyncLeases.ScheduledBudget);
        var candidates = await db.GoogleHealthNutritionSyncWork.IgnoreQueryFilters()
            .Where(x => (userId == null || x.UserId == userId) && GoogleHealthSyncLeases.Claimable.Contains(x.ProcessingState)
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
            string result;
            try { result = await ProcessOneAsync(lease, ct); }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                // The row keeps its lease; once it expires, the next run recovers it.
                logger?.LogWarning("Google Health nutrition sync stopped on one record: {FailureType}.", ex.GetType().Name);
                result = "retry";
            }
            succeeded += result == "succeeded" ? 1 : 0;
            retried += result == "retry" ? 1 : 0;
            failed += result == "failed" ? 1 : 0;
            unknown += result == "unknown" ? 1 : 0;
        }

        if (processed > 0)
            logger?.LogInformation("Google Health nutrition sync processed {Processed} records; succeeded={Succeeded}; retried={Retried}; failed={Failed}; unknown={Unknown}.", processed, succeeded, retried, failed, unknown);
        return new(processed, succeeded, retried, failed, unknown);
    }

    private async Task<NutritionWorkLease?> LeaseAsync(Guid userId, Guid workId, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        db.CurrentUser = userId;
        var work = await db.GoogleHealthNutritionSyncWork.SingleOrDefaultAsync(x => x.Id == workId, ct);
        if (work is null || !GoogleHealthSyncLeases.Claimable.Contains(work.ProcessingState) || work.NextAttemptAt > DateTime.UtcNow || work.LeaseUntil > DateTime.UtcNow)
            return null;
        if (GoogleHealthSyncLeases.IsInterruptedCreate(work.ProcessingState, work.GoogleResourceName, work.GoogleOperationName, work.DesiredDeleted))
        {
            MarkUnknown(work);
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
            return null;
        }
        var leaseId = Guid.NewGuid().ToString("N");
        work.ProcessingState = "processing";
        work.LeaseId = leaseId;
        work.LeaseUntil = DateTime.UtcNow.Add(LeaseDuration);
        work.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return new(userId, workId, leaseId, work.DesiredRevision, work.DesiredDate, work.DesiredTime, work.DesiredName,
            work.DesiredCalories, work.DesiredProtein, work.DesiredFat, work.DesiredCarbs, work.DesiredFiber,
            work.DesiredDeleted, work.GoogleResourceName, work.GoogleOperationName, work.ConnectionGeneration, work.GoogleIdHash);
    }

    private async Task<string> ProcessOneAsync(NutritionWorkLease lease, CancellationToken ct)
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

            var accessToken = await google.GetAccessTokenAsync(lease.UserId, NutritionScope, ct);
            if (string.IsNullOrWhiteSpace(accessToken))
            {
                await FinalizeAsync(lease, (work, _) => RetryAuthentication(work), ct);
                return "retry";
            }

            var timeZone = await ProfileTimeZoneAsync(lease.UserId, ct);
            var dataPoint = BuildDataPoint(lease.Date, lease.Time, lease.Name, lease.Calories, lease.Protein, lease.Fat, lease.Carbs, lease.Fiber, timeZone);

            GoogleHealthOperationResult result;
            if (!string.IsNullOrWhiteSpace(lease.OperationName))
                result = await GoogleHealthNutritionProvider.PollAsync(http, accessToken, lease.OperationName, ct);
            else if (lease.Deleted)
                result = await GoogleHealthNutritionProvider.DeleteAsync(http, accessToken, lease.ResourceName, ct);
            else if (!string.IsNullOrWhiteSpace(lease.ResourceName))
                result = await GoogleHealthNutritionProvider.UpdateAsync(http, accessToken, lease.ResourceName, dataPoint, ct);
            else
                result = await GoogleHealthNutritionProvider.CreateAsync(http, accessToken, dataPoint, ct);

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
        catch (GoogleHealthNutritionProviderException ex)
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

    private async Task FinalizeAsync(NutritionWorkLease lease, Action<GoogleHealthNutritionSyncWork, GoogleHealthNutritionSyncWork?> update, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        db.CurrentUser = lease.UserId;
        await using var gate = await MutationLock.Acquire(db, lease.UserId, ct);
        var work = await db.GoogleHealthNutritionSyncWork.SingleOrDefaultAsync(x => x.Id == lease.WorkId, ct);
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
        connection.NutritionLastSuccessfulSyncAt = DateTime.UtcNow;
        connection.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    private async Task<string?> ProfileTimeZoneAsync(Guid userId, CancellationToken ct)
        => await db.Users.Where(x => x.Id == userId).Select(x => x.ProfileJson).SingleOrDefaultAsync(ct) is { Length: > 0 } json
            ? Json.Read<Profile>(json).TimeZone
            : null;

    private static bool CanDispatch(GoogleHealthConnection connection)
        => connection.Status == "connected" && connection.NutritionSyncEnabled && HasNutritionScope(connection);

    private static bool HasNutritionScope(GoogleHealthConnection connection)
    {
        try
        {
            var scopes = JsonSerializer.Deserialize<string[]>(connection.GrantedScopesJson, Json.Options) ?? [];
            return scopes.Contains(NutritionScope, StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static void CancelWork(GoogleHealthNutritionSyncWork work)
    {
        work.ProcessingState = "cancelled";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.GoogleOperationName = "";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static void RetryAuthentication(GoogleHealthNutritionSyncWork work)
    {
        work.ProcessingState = "pending";
        work.NextAttemptAt = DateTime.UtcNow.AddHours(1);
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = "reconnect_required";
        work.LastErrorMessage = "Reconnect Google Health to resume nutrition uploads.";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static void Retry(GoogleHealthNutritionSyncWork work, TimeSpan? retryAfter)
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

    private static void MarkFailed(GoogleHealthNutritionSyncWork work, string? category, string? message)
    {
        work.ProcessingState = "failed";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = category ?? "provider_validation";
        work.LastErrorMessage = message ?? "Google Health rejected this nutrition upload.";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private static void MarkUnknown(GoogleHealthNutritionSyncWork work)
    {
        work.ProcessingState = "unknown";
        work.NextAttemptAt = DateTime.MaxValue;
        work.LeaseUntil = null;
        work.LeaseId = "";
        work.LastErrorCategory = "upload_status_unknown";
        work.LastErrorMessage = "The create response was lost. Check Google Health for a copy before requesting another upload.";
        work.UpdatedAt = DateTime.UtcNow;
    }

    private sealed record NutritionWorkLease(
        Guid UserId, Guid WorkId, string LeaseId, long DesiredRevision,
        DateOnly Date, string? Time, string Name, double Calories,
        double? Protein, double? Fat, double? Carbs, double? Fiber,
        bool Deleted, string ResourceName, string OperationName, long ConnectionGeneration, string GoogleIdHash);
}

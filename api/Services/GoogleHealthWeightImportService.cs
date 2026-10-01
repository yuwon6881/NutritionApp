using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record GoogleHealthWeightImportStatus(
    bool Enabled,
    bool PermissionGranted,
    string State,
    DateTime? LastSuccessAt,
    int LastImportedCount,
    long Revision,
    string? FailureCode = null,
    string? FailureMessage = null);

public sealed record GoogleHealthWeightImportResult(string Outcome, int Imported);

// Fills empty days with weigh-ins a smart scale wrote to Google Health. Imported rows are written
// outside SyncService.Apply, so they never create upload work and cannot echo back to Google.
public sealed class GoogleHealthWeightImportService(
    AppDb db,
    GoogleHealthService google,
    HttpClient http,
    ExpenditureTrajectoryService? trajectory = null,
    ILogger<GoogleHealthWeightImportService>? logger = null)
{
    public const string ReadScope = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";
    private static readonly TimeSpan MinimumInterval = TimeSpan.FromMinutes(2);

    public async Task<GoogleHealthWeightImportResult> RunAsync(bool force, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null || !connection.WeightImportEnabled || connection.Status != "connected" || !HasReadScope(connection))
            return new("skipped", 0);
        if (!force && connection.WeightImportLastAttemptAt is { } attempted && DateTime.UtcNow - attempted < MinimumInterval)
            return new("skipped", 0);

        var profileJson = await db.Users.Where(user => user.Id == userId).Select(user => user.ProfileJson).SingleAsync(ct);
        var zone = ProfileZone(profileJson);
        var today = RetentionService.Today(profileJson);
        var start = today.AddDays(-GoogleHealthWeightImportPlanner.LookbackDays);

        IReadOnlyList<GoogleHealthWeightReading> readings;
        try
        {
            var token = await google.GetAccessTokenAsync(userId, ReadScope, ct);
            if (string.IsNullOrEmpty(token))
            {
                await RecordAsync(connection, null, "provider_unavailable", "Could not reach Google Health to import weigh-ins.", ct);
                return new("failed", 0);
            }
            // A day boundary falls anywhere from UTC-12 to UTC+14, so the provider window is padded and
            // the planner trims readings to local dates.
            var from = new DateTimeOffset(start.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).AddDays(-1);
            var to = new DateTimeOffset(today.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).AddDays(2);
            readings = await GoogleHealthWeightReadProvider.ListAsync(http, token, from, to, ct);
        }
        catch (GoogleHealthWeightProviderException ex)
        {
            if (ex.AuthenticationFailure) await google.MarkReconnectRequiredAsync(userId, ct);
            await RecordAsync(connection, null, ex.Category, ex.Message, ct);
            return new("failed", 0);
        }

        var imported = await WriteAsync(userId, connection.ConnectionGeneration, readings, today, start, zone, ct);
        await RecordAsync(connection, imported, "", "", ct);
        return new("imported", imported);
    }

    private async Task<int> WriteAsync(Guid userId, long connectionGeneration, IReadOnlyList<GoogleHealthWeightReading> readings, DateOnly today, DateOnly start, TimeZoneInfo zone, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        // Consent may have changed while the provider was responding. Never write from a stale grant.
        var current = await db.GoogleHealthConnections.AsNoTracking().SingleOrDefaultAsync(ct);
        if (current is null || current.ConnectionGeneration != connectionGeneration || !current.WeightImportEnabled
            || current.Status != "connected" || !HasReadScope(current)) return 0;
        // Emptiness is decided under the lock so a weigh-in saved during the provider call always wins.
        var occupied = (await db.Weights.Where(weight => weight.Date >= start && weight.Date <= today)
            .Select(weight => weight.Date).ToListAsync(ct)).ToHashSet();
        var uploaded = (await db.GoogleHealthWeightSyncWork.Where(work => work.GoogleResourceName != "")
            .Select(work => work.GoogleResourceName).ToListAsync(ct)).ToHashSet(StringComparer.Ordinal);
        var candidates = GoogleHealthWeightImportPlanner.Plan(readings, today, zone, occupied, uploaded, google.ClientId);
        if (candidates.Count == 0) return 0;

        var user = await db.Users.SingleAsync(item => item.Id == userId, ct);
        var revision = user.Revision + 1;
        foreach (var candidate in candidates)
        {
            db.Weights.Add(new Weight
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Date = candidate.Date,
                Kg = candidate.Kg,
                Source = WeightSources.GoogleHealth,
                ExternalId = candidate.ResourceName,
                Revision = revision
            });
        }
        user.Revision = revision;
        user.TrajectoryRevision = revision;
        if (trajectory != null) await trajectory.RebuildFromUnderLock(candidates.Min(candidate => candidate.Date), revision, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return candidates.Count;
    }

    public async Task<GoogleHealthWeightImportStatus> SetPreferenceAsync(bool enabled, long expectedRevision, CancellationToken ct)
    {
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        await using var gate = await MutationLock.Acquire(db, userId, ct);
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        Validation.Require(connection is not null, "Connect Google Health before changing weigh-in import.", 409);
        Validation.Require(connection!.WeightImportRevision == expectedRevision, "Google Health settings changed on another device. Refresh and try again.", 409);
        Validation.Require(!enabled || HasReadScope(connection), "Google Health did not grant permission to read weight. Reconnect and allow it.", 409);

        // Turning import off only stops future imports; weigh-ins already imported are the user's record.
        connection.WeightImportEnabled = enabled;
        connection.WeightImportRevision++;
        connection.WeightImportLastAttemptAt = null;
        connection.WeightImportFailureCode = "";
        connection.WeightImportFailureMessage = "";
        connection.Revision++;
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return Status(connection);
    }

    public static GoogleHealthWeightImportStatus Status(GoogleHealthConnection? connection)
    {
        if (connection is null) return new(false, false, "disabled", null, 0, 0);
        var state = !connection.WeightImportEnabled ? "disabled"
            : connection.Status == "reconnect_required" ? "reconnect_required"
            : connection.WeightImportFailureCode != "" ? "failed"
            : "idle";
        return new(
            connection.WeightImportEnabled,
            HasReadScope(connection),
            state,
            connection.WeightImportLastSuccessAt,
            connection.WeightImportLastCount,
            connection.WeightImportRevision,
            connection.WeightImportFailureCode == "" ? null : connection.WeightImportFailureCode,
            connection.WeightImportFailureMessage == "" ? null : connection.WeightImportFailureMessage);
    }

    public static bool HasReadScope(GoogleHealthConnection connection)
    {
        try
        {
            var scopes = JsonSerializer.Deserialize<string[]>(connection.GrantedScopesJson, Json.Options) ?? [];
            return scopes.Contains(ReadScope, StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    // Status bookkeeping is best-effort: losing it to a concurrent settings change must not undo an import.
    private async Task RecordAsync(GoogleHealthConnection connection, int? imported, string failureCode, string failureMessage, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        connection.WeightImportLastAttemptAt = now;
        if (imported is { } count)
        {
            connection.WeightImportLastSuccessAt = now;
            connection.WeightImportLastCount = count;
        }
        connection.WeightImportFailureCode = failureCode;
        connection.WeightImportFailureMessage = failureMessage;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            logger?.LogInformation("Google Health weigh-in import status was superseded by a concurrent connection change.");
            await db.Entry(connection).ReloadAsync(ct);
        }
    }

    private static TimeZoneInfo ProfileZone(string? profileJson)
    {
        var id = string.IsNullOrEmpty(profileJson) ? "Asia/Kuala_Lumpur" : Json.Read<Profile>(profileJson).TimeZone;
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }
}

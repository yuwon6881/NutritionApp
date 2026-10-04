using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthWeightImportTests : IAsyncLifetime
{
    private const string OwnClientId = "nutrition-client.apps.googleusercontent.com";
    private static readonly TimeSpan Offset = TimeSpan.FromHours(8);
    private readonly ScriptedGoogle handler = new();
    private AppDb db = null!;
    private Guid userId;
    // Matches the default profile zone (Asia/Kuala_Lumpur) used when a user has no profile.
    private DateOnly today;

    public async Task InitializeAsync()
    {
        db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "import-user");
        userId = user.Id;
        db.CurrentUser = userId;
        today = RetentionService.Today(null);
        db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = userId,
            GoogleIdHash = "import-google",
            EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[]
            {
                GoogleHealthService.Scope, GoogleHealthWeightSyncService.WeightScope, GoogleHealthWeightImportService.ReadScope
            }),
            WeightSyncEnabled = true,
            WeightImportEnabled = true,
            Status = "connected"
        });
        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync() => await db.DisposeAsync();

    [Fact]
    public async Task Turning_import_off_during_the_provider_read_prevents_new_rows()
    {
        handler.Points.Add(Point("scale", At(today.AddDays(-1), 7), 72));
        handler.BeforeList = () => db.GoogleHealthConnections.ExecuteUpdateAsync(setters => setters
            .SetProperty(connection => connection.WeightImportEnabled, false)
            .SetProperty(connection => connection.Revision, connection => connection.Revision + 1));

        var result = await Import().RunAsync(force: true, default);

        Assert.Equal(0, result.Imported);
        Assert.Empty(await db.Weights.ToListAsync());
    }

    [Fact]
    public async Task Disconnecting_during_the_provider_read_prevents_new_rows()
    {
        handler.Points.Add(Point("scale", At(today.AddDays(-1), 7), 72));
        handler.BeforeList = () => db.GoogleHealthConnections.ExecuteDeleteAsync();

        var result = await Import().RunAsync(force: true, default);

        Assert.Equal(0, result.Imported);
        Assert.Empty(await db.Weights.ToListAsync());
        Assert.Empty(await db.GoogleHealthConnections.ToListAsync());
    }

    [Fact]
    public async Task A_manual_weigh_in_saved_during_the_provider_read_blocks_the_import()
    {
        var day = today.AddDays(-1);
        handler.Points.Add(Point("scale", At(day, 7), 72));
        handler.BeforeList = () => Sync().Apply(new Mutation(Guid.NewGuid(), "weight", Guid.NewGuid(), 0,
            JsonSerializer.SerializeToElement(new {date = day, kg = 71.8})), default);

        var result = await Import().RunAsync(force: true, default);

        Assert.Equal(0, result.Imported);
        var weight = await db.Weights.SingleAsync();
        Assert.Equal(71.8, weight.Kg);
        Assert.Equal(WeightSources.Manual, weight.Source);
    }

    [Fact]
    public async Task Fills_an_empty_day_with_its_earliest_reading_on_the_sample_local_date()
    {
        var day = today.AddDays(-2);
        // 07:30 at +08:00 is 23:30 UTC on the previous calendar day; the sample's own offset places it on `day`.
        handler.Points.Add(Point("late", At(day, 19, 0), 81.2));
        handler.Points.Add(Point("early", At(day, 7, 30), 80.4));

        var result = await Import().RunAsync(force: true, default);

        Assert.Equal(1, result.Imported);
        var weight = await db.Weights.SingleAsync();
        Assert.Equal(day, weight.Date);
        Assert.Equal(80.4, weight.Kg);
        Assert.Equal(WeightSources.GoogleHealth, weight.Source);
        Assert.Equal("users/me/dataTypes/weight/dataPoints/early", weight.ExternalId);
        Assert.Contains("filter=", handler.LastListUrl);
    }

    [Fact]
    public async Task Leaves_days_with_a_saved_or_deleted_weigh_in_untouched()
    {
        var saved = today.AddDays(-1);
        var deleted = today.AddDays(-3);
        db.Weights.Add(new Weight { Id = Guid.NewGuid(), UserId = userId, Date = saved, Kg = 70, Revision = 1 });
        db.Weights.Add(new Weight { Id = Guid.NewGuid(), UserId = userId, Date = deleted, Kg = 71, Revision = 1, Deleted = true });
        await db.SaveChangesAsync();
        handler.Points.Add(Point("saved", At(saved, 7), 90));
        handler.Points.Add(Point("deleted", At(deleted, 7), 91));

        var result = await Import().RunAsync(force: true, default);

        Assert.Equal(0, result.Imported);
        Assert.Equal(70, (await db.Weights.SingleAsync(w => w.Date == saved)).Kg);
        Assert.True((await db.Weights.SingleAsync(w => w.Date == deleted)).Deleted);
    }

    [Fact]
    public async Task Skips_readings_this_app_uploaded()
    {
        db.GoogleHealthWeightSyncWork.Add(new GoogleHealthWeightSyncWork
        {
            Id = Guid.NewGuid(), UserId = userId, WeightId = Guid.NewGuid(), ProcessingState = "succeeded",
            GoogleResourceName = "users/me/dataTypes/weight/dataPoints/mapped"
        });
        await db.SaveChangesAsync();
        handler.Points.Add(Point("mapped", At(today.AddDays(-1), 7), 72));
        handler.Points.Add(Point("own-client", At(today.AddDays(-2), 7), 72, OwnClientId));

        var result = await Import().RunAsync(force: true, default);

        Assert.Equal(0, result.Imported);
        Assert.Empty(await db.Weights.ToListAsync());
    }

    [Fact]
    public async Task Skips_implausible_values_and_dates_outside_the_window_instead_of_coercing_them()
    {
        handler.Points.Add(Point("too-light", At(today.AddDays(-1), 7), 5));
        handler.Points.Add(Point("too-heavy", At(today.AddDays(-2), 7), 500));
        handler.Points.Add(Point("tomorrow", At(today.AddDays(1), 7), 72));
        handler.Points.Add(Point("too-old", At(today.AddDays(-31), 7), 72));
        handler.Points.Add(Point("oldest-kept", At(today.AddDays(-30), 7), 72));

        var result = await Import().RunAsync(force: true, default);

        Assert.Equal(1, result.Imported);
        Assert.Equal(today.AddDays(-30), (await db.Weights.SingleAsync()).Date);
    }

    [Fact]
    public async Task Makes_no_provider_call_when_disabled_or_without_the_read_permission()
    {
        var connection = await db.GoogleHealthConnections.SingleAsync();
        connection.WeightImportEnabled = false;
        await db.SaveChangesAsync();
        Assert.Equal("skipped", (await Import().RunAsync(force: true, default)).Outcome);

        connection.WeightImportEnabled = true;
        connection.GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthService.Scope });
        await db.SaveChangesAsync();
        Assert.Equal("skipped", (await Import().RunAsync(force: true, default)).Outcome);

        Assert.Equal(0, handler.ListCalls);
    }

    [Fact]
    public async Task A_second_pass_is_throttled_and_a_forced_rerun_inserts_nothing_new()
    {
        handler.Points.Add(Point("a", At(today.AddDays(-1), 7), 72));
        handler.Points.Add(Point("b", At(today.AddDays(-2), 7), 73));

        await Import().RunAsync(force: true, default);
        var revision = (await db.Users.SingleAsync()).Revision;
        await Import().RunAsync(force: false, default);
        Assert.Equal(1, handler.ListCalls);
        var rerun = await Import().RunAsync(force: true, default);

        Assert.Equal(0, rerun.Imported);
        Assert.Equal(2, await db.Weights.CountAsync());
        var user = await db.Users.SingleAsync();
        Assert.Equal(revision, user.Revision);
        Assert.Equal(revision, user.TrajectoryRevision);
        Assert.All(await db.Weights.ToListAsync(), weight => Assert.Equal(revision, weight.Revision));
    }

    [Fact]
    public async Task The_trajectory_rebuilt_by_an_import_includes_the_imported_weigh_in()
    {
        var user = await db.Users.SingleAsync(item => item.Id == userId);
        user.ProfileJson = Json.Write(new Profile
        {
            Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4,
            Goal = "maintain", Maintenance = 2500, TimeZone = "Asia/Kuala_Lumpur"
        });
        user.ProfileRevision = 1;
        await db.SaveChangesAsync();
        handler.Points.Add(Point("scale", At(today.AddDays(-1), 7), 72));

        Assert.Equal(1, (await Import().RunAsync(force: true, default)).Imported);

        db.ChangeTracker.Clear();
        var point = await db.ExpenditureEstimates.AsNoTracking().SingleAsync(item => item.Date == today);
        Assert.Equal(72, point.TrendWeightKg!.Value, 3);
    }

    [Fact]
    public async Task Imported_weigh_ins_never_queue_uploads_and_an_edit_makes_them_manual()
    {
        handler.Points.Add(Point("scale", At(today.AddDays(-1), 7), 72));
        await Import().RunAsync(force: true, default);
        var imported = await db.Weights.AsNoTracking().SingleAsync();
        Assert.Empty(await db.GoogleHealthWeightSyncWork.ToListAsync());

        await Sync().Apply(new Mutation(Guid.NewGuid(), "weight", imported.Id, imported.Revision,
            JsonSerializer.SerializeToElement(new { date = imported.Date, kg = 71.5, source = "google_health" })), default);

        var edited = await db.Weights.AsNoTracking().SingleAsync();
        Assert.Equal(WeightSources.Manual, edited.Source);
        Assert.Equal(imported.ExternalId, edited.ExternalId);
        Assert.Empty(await db.GoogleHealthWeightSyncWork.ToListAsync());
    }

    [Fact]
    public async Task A_client_cannot_label_its_own_weigh_in_as_imported()
    {
        await Sync().Apply(new Mutation(Guid.NewGuid(), "weight", Guid.NewGuid(), 0,
            JsonSerializer.SerializeToElement(new { date = today, kg = 70, source = "google_health" })), default);

        Assert.Equal(WeightSources.Manual, (await db.Weights.SingleAsync()).Source);
    }

    [Fact]
    public async Task A_queued_manual_weigh_in_replaces_an_imported_one_for_the_same_day_without_uploading()
    {
        var day = today.AddDays(-1);
        handler.Points.Add(Point("scale", At(day, 7), 72));
        await Import().RunAsync(force: true, default);

        // The device queued this before it learned about the import, so it carries a new id.
        var manualId = Guid.NewGuid();
        await Sync().Apply(new Mutation(Guid.NewGuid(), "weight", manualId, 0,
            JsonSerializer.SerializeToElement(new { date = day, kg = 71.8 })), default);

        var weight = await db.Weights.AsNoTracking().SingleAsync();
        Assert.Equal(manualId, weight.Id);
        Assert.Equal(71.8, weight.Kg);
        Assert.Equal(WeightSources.Manual, weight.Source);
        Assert.Empty(await db.GoogleHealthWeightSyncWork.ToListAsync());
    }

    [Fact]
    public async Task A_manual_weigh_in_is_never_replaced_by_another_device_writing_the_same_day()
    {
        var day = today.AddDays(-1);
        await Sync().Apply(new Mutation(Guid.NewGuid(), "weight", Guid.NewGuid(), 0,
            JsonSerializer.SerializeToElement(new { date = day, kg = 70 })), default);

        await Assert.ThrowsAsync<DbUpdateException>(() => Sync().Apply(new Mutation(Guid.NewGuid(), "weight", Guid.NewGuid(), 0,
            JsonSerializer.SerializeToElement(new { date = day, kg = 75 })), default));
    }

    [Fact]
    public async Task Turning_import_off_or_disconnecting_keeps_imported_weigh_ins()
    {
        handler.Points.Add(Point("scale", At(today.AddDays(-1), 7), 72));
        await Import().RunAsync(force: true, default);
        var revision = (await db.GoogleHealthConnections.SingleAsync()).WeightImportRevision;

        var status = await Import().SetPreferenceAsync(false, revision, default);
        Assert.False(status.Enabled);
        Assert.Equal("disabled", status.State);
        Assert.Equal(1, await db.Weights.CountAsync(w => !w.Deleted));
        Assert.Equal("skipped", (await Import().RunAsync(force: true, default)).Outcome);

        await Google().DisconnectAsync(userId, default);
        Assert.Equal(1, await db.Weights.CountAsync(w => !w.Deleted && w.Source == WeightSources.GoogleHealth));
    }

    [Fact]
    public async Task Turning_import_back_on_fills_only_days_that_are_still_empty()
    {
        var removed = today.AddDays(-1);
        handler.Points.Add(Point("scale", At(removed, 7), 72));
        await Import().RunAsync(force: true, default);
        var imported = await db.Weights.AsNoTracking().SingleAsync();
        await Sync().Apply(new Mutation(Guid.NewGuid(), "weight", imported.Id, imported.Revision,
            JsonSerializer.SerializeToElement(imported), Delete: true), default);
        var connection = await db.GoogleHealthConnections.SingleAsync();
        await Import().SetPreferenceAsync(false, connection.WeightImportRevision, default);
        await Import().SetPreferenceAsync(true, connection.WeightImportRevision, default);
        handler.Points.Add(Point("new-day", At(today, 7), 71.5));

        var result = await Import().RunAsync(force: false, default);

        Assert.Equal(1, result.Imported);
        Assert.True((await db.Weights.SingleAsync(w => w.Date == removed)).Deleted);
        Assert.Equal(71.5, (await db.Weights.SingleAsync(w => w.Date == today)).Kg);
    }

    [Fact]
    public async Task Preference_changes_require_the_current_revision_and_the_read_permission()
    {
        var connection = await db.GoogleHealthConnections.SingleAsync();
        var stale = await Assert.ThrowsAsync<DomainException>(() => Import().SetPreferenceAsync(false, connection.WeightImportRevision + 5, default));
        Assert.Equal(409, stale.Status);

        connection.GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthService.Scope });
        await db.SaveChangesAsync();
        var missing = await Assert.ThrowsAsync<DomainException>(() => Import().SetPreferenceAsync(true, connection.WeightImportRevision, default));
        Assert.Equal(409, missing.Status);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden, "permissions_missing", "connected")]
    [InlineData(HttpStatusCode.ServiceUnavailable, "provider_unavailable", "connected")]
    [InlineData(HttpStatusCode.Unauthorized, "reconnect_required", "reconnect_required")]
    public async Task Provider_failures_are_recorded_on_the_import_status_without_writing(HttpStatusCode code, string failure, string connectionStatus)
    {
        handler.ListStatus = code;

        var result = await Import().RunAsync(force: true, default);

        Assert.Equal("failed", result.Outcome);
        Assert.Empty(await db.Weights.ToListAsync());
        var connection = await db.GoogleHealthConnections.AsNoTracking().SingleAsync();
        Assert.Equal(failure, connection.WeightImportFailureCode);
        Assert.Equal(connectionStatus, connection.Status);
    }

    [Fact]
    public async Task A_successful_pass_clears_the_previous_failure()
    {
        handler.ListStatus = HttpStatusCode.ServiceUnavailable;
        await Import().RunAsync(force: true, default);
        handler.ListStatus = HttpStatusCode.OK;
        handler.Points.Add(Point("scale", At(today, 7), 72));

        await Import().RunAsync(force: true, default);

        var status = GoogleHealthWeightImportService.Status(await db.GoogleHealthConnections.AsNoTracking().SingleAsync());
        Assert.Equal("idle", status.State);
        Assert.Equal(1, status.LastImportedCount);
        Assert.NotNull(status.LastSuccessAt);
    }

    [Fact]
    public async Task Connect_requests_the_read_permission_only_when_import_is_chosen()
    {
        var google = Google();
        var withImport = await google.GenerateConnectUrlAsync(userId, "session", "https://localhost", default, requestWeightImport: true);
        var withoutImport = await google.GenerateConnectUrlAsync(userId, "session", "https://localhost", default);

        Assert.Contains(Uri.EscapeDataString(GoogleHealthWeightImportService.ReadScope), withImport.AuthUrl);
        Assert.DoesNotContain(Uri.EscapeDataString(GoogleHealthWeightImportService.ReadScope), withoutImport.AuthUrl);
    }

    private GoogleHealthWeightImportService Import()
        => new(db, Google(), new HttpClient(handler), new ExpenditureTrajectoryService(db));

    private SyncService Sync()
        => new(db, weightSync: new GoogleHealthWeightSyncService(db, Google(), new HttpClient(handler)));

    private GoogleHealthService Google()
        => new(new HttpClient(handler), db, new PlainKms(), new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["GoogleHealth:ClientId"] = OwnClientId,
            ["GoogleHealth:ClientSecret"] = "secret",
            ["PublicOrigin"] = "https://localhost"
        }).Build());

    private static DateTimeOffset At(DateOnly date, int hour, int minute = 0)
        => new(date.ToDateTime(new TimeOnly(hour, minute)), Offset);

    private static object Point(string id, DateTimeOffset at, double kg, string? webClientId = null) => new
    {
        name = $"users/me/dataTypes/weight/dataPoints/{id}",
        dataSource = new { application = new { googleWebClientId = webClientId ?? "scale-app" } },
        weight = new
        {
            sampleTime = new { physicalTime = at.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"), utcOffset = $"{(int)at.Offset.TotalSeconds}s" },
            weightGrams = kg * 1000
        }
    };

    private sealed class ScriptedGoogle : HttpMessageHandler
    {
        public List<object> Points { get; } = [];
        public HttpStatusCode ListStatus { get; set; } = HttpStatusCode.OK;
        public int ListCalls { get; private set; }
        public string LastListUrl { get; private set; } = "";
        public Func<Task>? BeforeList { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var url = request.RequestUri!.ToString();
            if (url.StartsWith("https://oauth2.googleapis.com/token", StringComparison.Ordinal))
                return await Json(HttpStatusCode.OK, new { access_token = "access" });
            if (url.StartsWith("https://health.googleapis.com/v4/users/me/dataTypes/weight/dataPoints?", StringComparison.Ordinal))
            {
                ListCalls++;
                LastListUrl = url;
                if (BeforeList != null) await BeforeList();
                return ListStatus == HttpStatusCode.OK
                    ? await Json(HttpStatusCode.OK, new { dataPoints = Points })
                    : new HttpResponseMessage(ListStatus) { Content = new StringContent("{}") };
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") };
        }

        private static Task<HttpResponseMessage> Json(HttpStatusCode status, object body)
            => Task.FromResult(new HttpResponseMessage(status)
            {
                Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
            });
    }

    private sealed class PlainKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }
}

using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// The scheduled upload queues must recover from a run that stopped mid-upload, and one bad
/// row must not strand the rest of the batch.
public sealed class GoogleHealthSyncRecoveryTests
{
    private const string GoogleIdHash = "recovery-google";

    [Theory]
    [InlineData("weight")]
    [InlineData("nutrition")]
    [InlineData("body_fat")]
    public async Task Interrupted_create_becomes_unknown_instead_of_uploading_a_possible_duplicate(string kind)
    {
        await using var context = await Context.Create(kind);
        var stale = DateTime.UtcNow.AddMinutes(-10);
        context.AddWork(state: "processing", leaseUntil: stale);
        await context.Db.SaveChangesAsync();
        var handler = new RecordingHandler(_ => throw new InvalidOperationException("An interrupted create must not be re-sent."));

        await context.ProcessDue(handler);

        Assert.Equal("unknown", Assert.Single(await context.States()));
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task Unexpected_failure_on_one_row_does_not_abandon_the_rest_of_the_batch()
    {
        await using var context = await Context.Create("weight");
        context.AddWork(state: "pending", leaseUntil: null);
        context.AddWork(state: "pending", leaseUntil: null);
        await context.Db.SaveChangesAsync();
        // A token response that is not JSON fails outside the provider's classified errors.
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<html>proxy error</html>", Encoding.UTF8, "text/html")
        });

        var processed = await context.ProcessDue(handler);

        Assert.Equal(2, processed);
        Assert.Equal(2, handler.Calls);
    }

    [Fact]
    public async Task Active_user_flush_leases_only_that_users_uploads()
    {
        await using var context = await Context.Create("weight");
        context.AddWork(state: "pending", leaseUntil: null);
        var otherUser = Guid.NewGuid();
        context.Db.MaintenanceAccess = true;
        context.Db.Users.Add(new AppUser { Id = otherUser, DisplayName = "other-user", IdentitySubject = "other-subject" });
        context.Db.GoogleHealthWeightSyncWork.Add(new GoogleHealthWeightSyncWork
        {
            Id = Guid.NewGuid(), UserId = otherUser, WeightId = Guid.NewGuid(), DesiredRevision = 1,
            DesiredDate = new DateOnly(2026, 9, 18), DesiredKg = 80, GoogleIdHash = "other-google",
            ConnectionGeneration = 1, ProcessingState = "pending", NextAttemptAt = DateTime.UtcNow.AddMinutes(-10)
        });
        await context.Db.SaveChangesAsync();
        context.Db.MaintenanceAccess = false;
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));

        var processed = await context.ProcessDue(handler, onlyActiveUser: true);

        Assert.Equal(1, processed);
        context.Db.ChangeTracker.Clear();
        var other = await context.Db.GoogleHealthWeightSyncWork.IgnoreQueryFilters().SingleAsync(x => x.UserId == otherUser);
        Assert.Equal("pending", other.ProcessingState);
        Assert.Null(other.LeaseUntil);
    }

    private sealed class Context : IAsyncDisposable
    {
        private readonly string kind;
        public AppDb Db { get; }
        private Guid UserId => Db.CurrentUser!.Value;

        private Context(AppDb db, string kind)
        {
            Db = db;
            this.kind = kind;
        }

        public static async Task<Context> Create(string kind)
        {
            var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options)
            {
                CurrentUser = Guid.NewGuid()
            };
            await db.Database.OpenConnectionAsync();
            await db.Database.EnsureCreatedAsync();
            db.Users.Add(new AppUser { Id = db.CurrentUser.Value, DisplayName = "sync-user", IdentitySubject = "sync-subject" });
            db.GoogleHealthConnections.Add(new GoogleHealthConnection
            {
                UserId = db.CurrentUser.Value,
                GoogleIdHash = GoogleIdHash,
                EncryptedRefreshToken = "refresh",
                GrantedScopesJson = JsonSerializer.Serialize(new[]
                {
                    GoogleHealthWeightSyncService.WeightScope,
                    GoogleHealthNutritionSyncService.NutritionScope,
                    GoogleHealthBodyFatSyncService.BodyFatScope
                }),
                WeightSyncEnabled = true,
                NutritionSyncEnabled = true,
                BodyFatSyncEnabled = true,
                Status = "connected"
            });
            await db.SaveChangesAsync();
            return new Context(db, kind);
        }

        public void AddWork(string state, DateTime? leaseUntil)
        {
            var due = DateTime.UtcNow.AddMinutes(-10);
            var leaseId = leaseUntil is null ? "" : "previous-run";
            var date = new DateOnly(2026, 9, 18);
            switch (kind)
            {
                case "weight":
                    Db.GoogleHealthWeightSyncWork.Add(new GoogleHealthWeightSyncWork
                    {
                        Id = Guid.NewGuid(), UserId = UserId, WeightId = Guid.NewGuid(), DesiredRevision = 1, DesiredDate = date, DesiredKg = 72.5,
                        GoogleIdHash = GoogleIdHash, ConnectionGeneration = 1, ProcessingState = state,
                        NextAttemptAt = due, LeaseUntil = leaseUntil, LeaseId = leaseId
                    });
                    break;
                case "nutrition":
                    Db.GoogleHealthNutritionSyncWork.Add(new GoogleHealthNutritionSyncWork
                    {
                        Id = Guid.NewGuid(), UserId = UserId, EntryId = Guid.NewGuid(), DesiredRevision = 1, DesiredDate = date, DesiredName = "Oats",
                        DesiredCalories = 300, GoogleIdHash = GoogleIdHash, ConnectionGeneration = 1, ProcessingState = state,
                        NextAttemptAt = due, LeaseUntil = leaseUntil, LeaseId = leaseId
                    });
                    break;
                default:
                    Db.GoogleHealthBodyFatSyncWork.Add(new GoogleHealthBodyFatSyncWork
                    {
                        Id = Guid.NewGuid(), UserId = UserId, BodyRecordId = Guid.NewGuid(), DesiredRevision = 1, DesiredDate = date, DesiredBodyFatPercent = 18,
                        GoogleIdHash = GoogleIdHash, ConnectionGeneration = 1, ProcessingState = state,
                        NextAttemptAt = due, LeaseUntil = leaseUntil, LeaseId = leaseId
                    });
                    break;
            }
        }

        public async Task<int> ProcessDue(HttpMessageHandler handler, bool onlyActiveUser = false)
        {
            var http = new HttpClient(handler, disposeHandler: false);
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["GoogleHealth:ClientId"] = "client",
                ["GoogleHealth:ClientSecret"] = "secret"
            }).Build();
            var google = new GoogleHealthService(http, Db, new TestKms(), config);
            Guid? scope = onlyActiveUser ? UserId : null;
            return kind switch
            {
                "weight" => (await new GoogleHealthWeightSyncService(Db, google, http).ProcessDueAsync(default, scope)).Processed,
                "nutrition" => (await new GoogleHealthNutritionSyncService(Db, google, http).ProcessDueAsync(default, scope)).Processed,
                _ => (await new GoogleHealthBodyFatSyncService(Db, google, http).ProcessDueAsync(default, scope)).Processed
            };
        }

        public async Task<List<string>> States()
        {
            Db.ChangeTracker.Clear();
            return kind switch
            {
                "weight" => await Db.GoogleHealthWeightSyncWork.Select(x => x.ProcessingState).ToListAsync(),
                "nutrition" => await Db.GoogleHealthNutritionSyncWork.Select(x => x.ProcessingState).ToListAsync(),
                _ => await Db.GoogleHealthBodyFatSyncWork.Select(x => x.ProcessingState).ToListAsync()
            };
        }

        public async ValueTask DisposeAsync() => await Db.DisposeAsync();
    }

    private sealed class RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(respond(request));
        }
    }

    private sealed class TestKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }
}

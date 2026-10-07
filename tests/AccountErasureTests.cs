using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Web;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Endpoints;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class AccountErasureTests
{
    private const string Issuer = "https://fitness-account.example";
    private const string ClientId = "nutrition-api";

    [Fact]
    public async Task A_deletion_notice_erases_every_owned_row_every_stored_image_generation_and_the_google_grant()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-erasure-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new ErasureFactory(dbPath);
            Guid doomed, survivor;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                await db.Database.EnsureCreatedAsync();
                doomed = await SeedAccount(db, "doomed-subject");
                survivor = await SeedAccount(db, "surviving-subject");
            }
            factory.Storage.Seed("physique-bucket", $"nutrition-physique/{doomed}/front.jpg", "1", "2");
            factory.Storage.Seed("scan-bucket", $"nutrition-scans/{doomed}/scan.jpg", "7");
            factory.Storage.Seed("physique-bucket", $"nutrition-physique/{survivor}/front.jpg", "3");
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

            // No session cookie and no browser origin: the signed notice is the only credential.
            var rejected = await client.PostAsync(AccountDeletionEndpoints.Path, Notice("forged"));
            Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
            using (var scope = factory.Services.CreateScope())
                Assert.True(await scope.ServiceProvider.GetRequiredService<AppDb>().Users.AnyAsync(user => user.Id == doomed));

            var erased = await client.PostAsync(AccountDeletionEndpoints.Path, Notice("valid:doomed-subject"));

            Assert.Equal(HttpStatusCode.NoContent, erased.StatusCode);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                Assert.False(await db.Users.AnyAsync(user => user.Id == doomed));
                Assert.All(await RowsOwnedBy(db, doomed), table => Assert.True(table.Value == 0, $"{table.Key} still holds {table.Value} row(s)."));
                var kept = await RowsOwnedBy(db, survivor);
                Assert.True(kept.Count(table => table.Value > 0) >= 10, "The surviving account lost rows it owns.");
            }
            Assert.Empty(factory.Storage.Under($"nutrition-physique/{doomed}/"));
            Assert.Empty(factory.Storage.Under($"nutrition-scans/{doomed}/"));
            Assert.Single(factory.Storage.Under($"nutrition-physique/{survivor}/"));
            Assert.Contains(factory.Google.Requests, url => url.StartsWith("https://oauth2.googleapis.com/revoke", StringComparison.Ordinal));

            // A retried notice for an already-erased subject is acknowledged again.
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync(AccountDeletionEndpoints.Path, Notice("valid:doomed-subject"))).StatusCode);
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(dbPath)) File.Delete(dbPath);
        }
    }

    [Fact]
    public async Task Storage_that_cannot_be_erased_keeps_the_account_so_the_notice_is_retried()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-erasure-retry-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new ErasureFactory(dbPath);
            Guid doomed;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                await db.Database.EnsureCreatedAsync();
                doomed = await SeedAccount(db, "retry-subject");
            }
            factory.Storage.Seed("physique-bucket", $"nutrition-physique/{doomed}/front.jpg", "1");
            factory.Storage.Unavailable = true;
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

            var failed = await client.PostAsync(AccountDeletionEndpoints.Path, Notice("valid:retry-subject"));

            Assert.False(failed.IsSuccessStatusCode);
            using (var scope = factory.Services.CreateScope())
                Assert.True(await scope.ServiceProvider.GetRequiredService<AppDb>().Users.AnyAsync(user => user.Id == doomed));

            factory.Storage.Unavailable = false;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync(AccountDeletionEndpoints.Path, Notice("valid:retry-subject"))).StatusCode);
            Assert.Empty(factory.Storage.Under($"nutrition-physique/{doomed}/"));
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(dbPath)) File.Delete(dbPath);
        }
    }

    [Fact]
    public void Every_user_owned_table_cascades_from_the_user_row()
    {
        using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options);
        var userType = db.Model.FindEntityType(typeof(AppUser))!;
        foreach (var entity in db.Model.GetEntityTypes().Where(entity => !entity.IsOwned() && entity.ClrType != typeof(AppUser)))
        {
            foreach (var property in entity.GetProperties().Where(IsUserReference))
            {
                var cascades = property.GetContainingForeignKeys().Any(key =>
                    key.PrincipalEntityType == userType && key.DeleteBehavior == DeleteBehavior.Cascade);
                Assert.True(cascades, $"{entity.ClrType.Name}.{property.Name} names a user but does not cascade from Users; account erasure would leave it behind.");
            }
        }
    }

    [Fact]
    public void The_applied_migrations_carry_the_same_cascades_as_the_model()
    {
        using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseNpgsql("Host=unused;Database=unused").Options);
        Assert.False(db.Database.HasPendingModelChanges(), "The model differs from the migration snapshot.");
    }

    [Fact]
    public void A_genuine_deletion_notice_yields_its_subject()
    {
        using var rsa = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa) { KeyId = "signing" };

        Assert.Equal("subject-1", SharedAccessTokenService.ReadAccountDeletionSubject(Sign(key), ClientId, Issuer + "/", [key]));
    }

    [Theory]
    [InlineData("identity-token")]
    [InlineData("nonce")]
    [InlineData("no-event")]
    [InlineData("other-audience")]
    [InlineData("other-issuer")]
    [InlineData("expired")]
    [InlineData("other-key")]
    public void Anything_but_a_genuine_deletion_notice_is_rejected(string variant)
    {
        using var rsa = RSA.Create(2048);
        using var otherRsa = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa) { KeyId = "signing" };
        var token = variant switch
        {
            "identity-token" => Sign(key, type: "JWT"),
            "nonce" => Sign(key, extra: new Dictionary<string, object> { ["nonce"] = "n" }),
            "no-event" => Sign(key, events: false),
            "other-audience" => Sign(key, audience: "workout-api"),
            "other-issuer" => Sign(key, issuer: "https://attacker.example"),
            "expired" => Sign(key, expires: DateTime.UtcNow.AddMinutes(-5)),
            _ => Sign(new RsaSecurityKey(otherRsa) { KeyId = "signing" })
        };

        Assert.ThrowsAny<SecurityTokenException>(() =>
            SharedAccessTokenService.ReadAccountDeletionSubject(token, ClientId, Issuer, [key]));
    }

    private static bool IsUserReference(IProperty property)
        => (property.ClrType == typeof(Guid) || property.ClrType == typeof(Guid?)) &&
           property.Name.EndsWith("UserId", StringComparison.Ordinal);

    private static string Sign(SecurityKey key, string type = SharedAccessTokenService.AccountDeletionTokenType,
        string audience = ClientId, string issuer = Issuer, bool events = true, DateTime? expires = null,
        Dictionary<string, object>? extra = null)
    {
        var claims = new Dictionary<string, object>(extra ?? []);
        if (events) claims["events"] = new Dictionary<string, object> { [SharedAccessTokenService.AccountDeletionEvent] = new Dictionary<string, object>() };
        var expiry = expires ?? DateTime.UtcNow.AddMinutes(5);
        return new Microsoft.IdentityModel.JsonWebTokens.JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            TokenType = type,
            IssuedAt = expiry.AddMinutes(-10),
            NotBefore = expiry.AddMinutes(-10),
            Expires = expiry,
            Subject = new ClaimsIdentity([new Claim("sub", "subject-1"), new Claim("jti", Guid.NewGuid().ToString("N"))]),
            Claims = claims,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.RsaSha256)
        });
    }

    private static FormUrlEncodedContent Notice(string token) => new([new KeyValuePair<string, string>("deletion_token", token)]);

    private static async Task<Guid> SeedAccount(AppDb db, string subject)
    {
        var user = await TestUsers.CreateAsync(db, subject, subject);
        db.CurrentUser = user.Id;
        db.MaintenanceAccess = true;
        var date = new DateOnly(2026, 9, 7);
        db.Sessions.Add(new Session { UserId = user.Id, Hash = AuthService.Hash(Guid.NewGuid().ToString("N")), Expires = DateTime.UtcNow.AddDays(1) });
        db.Entries.Add(new DiaryEntry { Id = Guid.NewGuid(), UserId = user.Id, Date = date, Name = "Rice", Calories = 200 });
        db.Weights.Add(new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = date, Kg = 80 });
        db.Days.Add(new DayStatus { Id = Guid.NewGuid(), UserId = user.Id, Date = date, Status = "complete" });
        db.Plans.Add(new AcceptedPlan { Id = Guid.NewGuid(), UserId = user.Id, Date = date });
        db.Foods.Add(new Food { Id = Guid.NewGuid(), UserId = user.Id, Name = "Oats", Calories = 380 });
        db.Scans.Add(new ScanJob { Id = Guid.NewGuid(), UserId = user.Id, ObjectPath = $"{ScanService.ObjectPrefix(user.Id)}scan.jpg" });
        db.Photos.Add(new PhysiquePhoto { Id = Guid.NewGuid(), UserId = user.Id, Date = date, ObjectPath = $"{PhotoService.ObjectPrefix(user.Id)}front.jpg", Status = "complete" });
        db.PhotoObjectDeletions.Add(new PhotoObjectDeletion { Id = Guid.NewGuid(), UserId = user.Id, ObjectPath = $"{PhotoService.ObjectPrefix(user.Id)}front.jpg", ObjectGeneration = "1" });
        db.Receipts.Add(new MutationReceipt { Id = Guid.NewGuid(), UserId = user.Id, Hash = "hash", Revision = 1 });
        db.Usage.Add(new AiUsage { UserId = user.Id, Date = date, Requests = 1 });
        db.GoogleHealthConnections.Add(new GoogleHealthConnection { UserId = user.Id, GoogleIdHash = subject, EncryptedRefreshToken = "encrypted" });
        db.NutritionPushSubscriptions.Add(new NutritionPushSubscription { UserId = user.Id, DeviceId = "device", FcmToken = "token", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        db.AiConversations.Add(new AiConversation { UserId = user.Id });
        await db.SaveChangesAsync();
        return user.Id;
    }

    /// Counts, for every mapped table with a user column, the rows that still name this user.
    private static async Task<Dictionary<string, long>> RowsOwnedBy(AppDb db, Guid userId)
    {
        var counts = new Dictionary<string, long>();
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) await connection.OpenAsync();
        foreach (var entity in db.Model.GetEntityTypes().Where(entity => !entity.IsOwned()))
        {
            foreach (var property in entity.GetProperties().Where(IsUserReference))
            {
                await using var command = connection.CreateCommand();
                command.CommandText = $"SELECT COUNT(*) FROM \"{entity.GetTableName()}\" WHERE \"{property.GetColumnName()}\" = $id";
                var parameter = command.CreateParameter();
                parameter.ParameterName = "$id";
                parameter.Value = userId.ToString().ToUpperInvariant();
                command.Parameters.Add(parameter);
                counts[$"{entity.GetTableName()}.{property.Name}"] = Convert.ToInt64(await command.ExecuteScalarAsync());
            }
        }
        return counts;
    }

    private sealed class ErasureFactory(string dbPath) : WebApplicationFactory<Program>
    {
        public FakeStorage Storage { get; } = new();
        public RecordingHandler Google { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:SqlitePath"] = dbPath,
                ["PublicOrigin"] = "https://nutrition.example.com",
                ["Physique:Bucket"] = "physique-bucket",
                ["ScanStorage:Bucket"] = "scan-bucket"
            }));
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<IAccountDeletionNoticeValidator, PrefixValidator>();
                services.AddSingleton<IGoogleHealthKms, PlainKms>();
                services.AddHttpClient<GoogleHealthService>().ConfigurePrimaryHttpMessageHandler(() => Google);
                services.AddTransient(sp => new GcsPhotoStore(new HttpClient(Storage), sp.GetRequiredService<IConfiguration>(), _ => Task.FromResult("token")));
                services.AddTransient(sp => new TemporaryImageStore(new HttpClient(Storage), sp.GetRequiredService<IConfiguration>(), _ => Task.FromResult("token")));
            });
        }
    }

    private sealed class PrefixValidator : IAccountDeletionNoticeValidator
    {
        public Task<string> ValidateAsync(string token, CancellationToken ct)
            => token.StartsWith("valid:", StringComparison.Ordinal)
                ? Task.FromResult(token["valid:".Length..])
                : throw new DomainException("The account deletion notice is invalid.", 401);
    }

    private sealed class PlainKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult("google-refresh-token");
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public ConcurrentQueue<string> Requests { get; } = new();

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Enqueue(request.RequestUri!.ToString());
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        }
    }

    /// A versioned bucket: listing returns every generation, and a delete removes exactly one.
    private sealed class FakeStorage : HttpMessageHandler
    {
        private readonly ConcurrentDictionary<(string Bucket, string Name, string Generation), byte> objects = new();
        public bool Unavailable { get; set; }

        public void Seed(string bucket, string name, params string[] generations)
        {
            foreach (var generation in generations) objects[(bucket, name, generation)] = 0;
        }

        public IEnumerable<string> Under(string prefix) => objects.Keys.Where(key => key.Name.StartsWith(prefix, StringComparison.Ordinal)).Select(key => key.Name);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (Unavailable) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
            var path = request.RequestUri!.AbsolutePath;
            var bucket = Uri.UnescapeDataString(path.Split("/b/")[1].Split('/')[0]);
            var query = HttpUtility.ParseQueryString(request.RequestUri.Query);
            if (request.Method == HttpMethod.Get && path.EndsWith("/o", StringComparison.Ordinal))
            {
                Assert.Equal("true", query["versions"]);
                var prefix = query["prefix"]!;
                var items = objects.Keys.Where(key => key.Bucket == bucket && key.Name.StartsWith(prefix, StringComparison.Ordinal))
                    .Select(key => new { name = key.Name, generation = key.Generation });
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent(new { items }) });
            }
            if (request.Method == HttpMethod.Delete)
            {
                var name = Uri.UnescapeDataString(request.RequestUri.AbsolutePath.Split("/o/")[1]);
                return Task.FromResult(new HttpResponseMessage(objects.TryRemove((bucket, name, query["generation"]!), out _) ? HttpStatusCode.NoContent : HttpStatusCode.NotFound));
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest));
        }

        private static StringContent JsonContent(object value) => new(System.Text.Json.JsonSerializer.Serialize(value), System.Text.Encoding.UTF8, "application/json");
    }
}

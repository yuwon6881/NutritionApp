using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthTests : IAsyncLifetime
{
    private readonly string dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-gh-{Guid.NewGuid()}.db");
    private AppDb Open(Guid? user = null) => new(new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={dbPath}").Options) { CurrentUser = user };

    private static IConfiguration Config => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["PublicOrigin"] = "https://nutrition.example.com",
        ["GoogleHealth:ClientId"] = "test-client-id.apps.googleusercontent.com",
        ["GoogleHealth:ClientSecret"] = "test-client-secret",
        ["Retention:MealDetailDays"] = "90"
    }).Build();

    private readonly IGoogleHealthKms kms;

    public GoogleHealthTests()
    {
        var envMock = new TestHostEnvironment { EnvironmentName = "Development" };
        kms = new GoogleCloudKmsService(new HttpClient(new MockHttpHandler()), Config, envMock);
    }

    public async Task InitializeAsync()
    {
        await using var db = Open();
        await db.Database.EnsureCreatedAsync();
    }

    public Task DisposeAsync()
    {
        GoogleHealthService.ClearMemoryCache();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(dbPath)) File.Delete(dbPath);
        return Task.CompletedTask;
    }

    [Fact]
    public async Task OAuthState_Binding_And_Validation()
    {
        var userId = Guid.NewGuid();
        var sessionHash = "session-hash-123";

        await using (var db = Open(userId))
        {
            db.Users.Add(new AppUser { Id = userId, DisplayName = "user1", IdentitySubject = "sub_user1" });
            await db.SaveChangesAsync();
        }

        await using var dbUser = Open(userId);
        var mockHttp = new MockHttpHandler();
        var service = new GoogleHealthService(new HttpClient(mockHttp), dbUser, kms, Config);

        // 1. Generate auth URL
        var connectResult = await service.GenerateConnectUrlAsync(userId, sessionHash, "https://nutrition.example.com", default);
        Assert.Contains("accounts.google.com/o/oauth2/v2/auth", connectResult.AuthUrl);
        Assert.Contains("client_id=test-client-id.apps.googleusercontent.com", connectResult.AuthUrl);
        Assert.Contains("scope=openid%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgooglehealth.activity_and_fitness.readonly", connectResult.AuthUrl);

        var stateQuery = System.Web.HttpUtility.ParseQueryString(new Uri(connectResult.AuthUrl).Query)["state"];
        Assert.NotNull(stateQuery);

        // State record exists in DB
        var stateRecord = await dbUser.GoogleHealthOAuthStates.SingleOrDefaultAsync(s => s.State == stateQuery);
        Assert.NotNull(stateRecord);
        Assert.Equal(userId, stateRecord.UserId);
        Assert.Equal(sessionHash, stateRecord.SessionHash);

        // 2. Callback with wrong session must be rejected
        var wrongSessionResult = await service.HandleCallbackAsync("code123", stateQuery, null, userId, "wrong-session", "https://nutrition.example.com", default);
        Assert.Contains("code=session_mismatch", wrongSessionResult);

        // 3. Re-generate state for valid test
        connectResult = await service.GenerateConnectUrlAsync(userId, sessionHash, "https://nutrition.example.com", default);
        var validState = System.Web.HttpUtility.ParseQueryString(new Uri(connectResult.AuthUrl).Query)["state"];

        mockHttp.TokenResponse = new { access_token = "at-1", refresh_token = "rt-1", expires_in = 3600 };
        mockHttp.TokenInfoResponse = new { sub = "google-user-12345" };

        var callbackResult = await service.HandleCallbackAsync("code123", validState, null, userId, sessionHash, "https://nutrition.example.com", default);
        Assert.Equal("/settings?google_health=connected", callbackResult);
        Assert.Equal("Bearer at-1", mockHttp.LastUserInfoAuthorization);

        // State must be deleted after use (single-use)
        var usedState = await dbUser.GoogleHealthOAuthStates.SingleOrDefaultAsync(s => s.State == validState);
        Assert.Null(usedState);

        // Trying callback again with same state must fail
        var replayResult = await service.HandleCallbackAsync("code123", validState, null, userId, sessionHash, "https://nutrition.example.com", default);
        Assert.Contains("code=invalid_state", replayResult);
    }

    [Fact]
    public async Task Duplicate_Google_Identity_Rejection()
    {
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();

        await using (var db = Open())
        {
            db.Users.AddRange(
                new AppUser { Id = userA, DisplayName = "usera", IdentitySubject = "sub_usera" },
                new AppUser { Id = userB, DisplayName = "userb", IdentitySubject = "sub_userb" }
            );
            await db.SaveChangesAsync();
        }

        var mockHttp = new MockHttpHandler
        {
            TokenResponse = new { access_token = "at-user", refresh_token = "rt-user", expires_in = 3600 },
            TokenInfoResponse = new { sub = "google-shared-identity-999" }
        };

        // Connect user A with Google ID 999
        await using (var dbA = Open(userA))
        {
            var serviceA = new GoogleHealthService(new HttpClient(mockHttp), dbA, kms, Config);
            var connA = await serviceA.GenerateConnectUrlAsync(userA, "sess-a", "https://nutrition.example.com", default);
            var stateA = System.Web.HttpUtility.ParseQueryString(new Uri(connA.AuthUrl).Query)["state"];
            var resA = await serviceA.HandleCallbackAsync("codeA", stateA, null, userA, "sess-a", "https://nutrition.example.com", default);
            Assert.Equal("/settings?google_health=connected", resA);
        }

        // Try connecting user B with the same Google ID 999
        await using (var dbB = Open(userB))
        {
            var serviceB = new GoogleHealthService(new HttpClient(mockHttp), dbB, kms, Config);
            var connB = await serviceB.GenerateConnectUrlAsync(userB, "sess-b", "https://nutrition.example.com", default);
            var stateB = System.Web.HttpUtility.ParseQueryString(new Uri(connB.AuthUrl).Query)["state"];
            var resB = await serviceB.HandleCallbackAsync("codeB", stateB, null, userB, "sess-b", "https://nutrition.example.com", default);

            // Must reject as duplicate_account
            Assert.Equal("/settings?google_health=error&code=duplicate_account", resB);

            // User B must have NO connection record
            var userBConn = await dbB.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userB);
            Assert.Null(userBConn);
        }
    }

    [Fact]
    public async Task KMS_Encryption_At_Rest_And_No_AccessToken_Persistence()
    {
        var userId = Guid.NewGuid();
        await using (var db = Open(userId))
        {
            db.Users.Add(new AppUser { Id = userId, DisplayName = "encrypt_test", IdentitySubject = "sub_encrypt_test" });
            await db.SaveChangesAsync();
        }

        var mockHttp = new MockHttpHandler
        {
            TokenResponse = new { access_token = "secret-access-token-xyz", refresh_token = "secret-refresh-token-abc", expires_in = 3600 },
            TokenInfoResponse = new { sub = "google-id-secret-777" }
        };

        await using (var db = Open(userId))
        {
            var service = new GoogleHealthService(new HttpClient(mockHttp), db, kms, Config);
            var connUrl = await service.GenerateConnectUrlAsync(userId, "sess", "https://nutrition.example.com", default);
            var state = System.Web.HttpUtility.ParseQueryString(new Uri(connUrl.AuthUrl).Query)["state"];
            await service.HandleCallbackAsync("code", state, null, userId, "sess", "https://nutrition.example.com", default);
        }

        // Inspect raw database storage
        await using (var db = Open(userId))
        {
            var conn = await db.GoogleHealthConnections.SingleAsync(c => c.UserId == userId);

            // Refresh token and Google ID must be stored in encrypted form
            Assert.DoesNotContain("secret-refresh-token-abc", conn.EncryptedRefreshToken);
            Assert.DoesNotContain("google-id-secret-777", conn.EncryptedGoogleId);

            // Decrypting recovers the plaintext
            var decryptedRt = await kms.DecryptAsync(conn.EncryptedRefreshToken, default);
            Assert.Equal("secret-refresh-token-abc", decryptedRt);
            var decryptedGid = await kms.DecryptAsync(conn.EncryptedGoogleId, default);
            Assert.Equal("google-id-secret-777", decryptedGid);

            // Access token must NOT be stored in any property
            var properties = typeof(GoogleHealthConnection).GetProperties();
            foreach (var prop in properties)
            {
                var val = prop.GetValue(conn)?.ToString() ?? "";
                Assert.DoesNotContain("secret-access-token-xyz", val);
            }
        }
    }

    [Fact]
    public async Task Sync_Rollup_31_Days_TrueZero_And_Missing_Data()
    {
        var userId = Guid.NewGuid();
        var profile = new Profile
        {
            Age = 28,
            HeightCm = 175,
            WeightKg = 72,
            Sex = "male",
            Activity = 1.5,
            Goal = "maintain",
            TimeZone = "Asia/Kuala_Lumpur"
        };

        await using (var db = Open(userId))
        {
            db.Users.Add(new AppUser { Id = userId, DisplayName = "sync_user", IdentitySubject = "sub_sync_user", ProfileJson = Json.Write(profile) });
            await db.SaveChangesAsync();
        }

        var today = RetentionService.Today(Json.Write(profile));
        var yesterday = today.AddDays(-1);
        var dayBeforeYesterday = today.AddDays(-2);

        var mockHttp = new MockHttpHandler
        {
            TokenResponse = new { access_token = "at-fresh", refresh_token = "rt-fresh", expires_in = 3600 },
            TokenInfoResponse = new { sub = "gid-sync" }
        };

        // Prepare rollup response from Google:
        // today has 8450 steps
        // yesterday has 0 steps (explicit true zero)
        // dayBeforeYesterday is missing from Google response
        mockHttp.DailyRollupResponse = new
        {
            dataPoints = new object[]
            {
                new
                {
                    civilStartTime = new { date = new { year = today.Year, month = today.Month, day = today.Day } },
                    stepsRollupValue = new { countSum = "8450" }
                },
                new
                {
                    civilStartTime = new { date = new { year = yesterday.Year, month = yesterday.Month, day = yesterday.Day } },
                    stepsRollupValue = new { countSum = "0" }
                }
            }
        };

        await using (var db = Open(userId))
        {
            var service = new GoogleHealthService(new HttpClient(mockHttp), db, kms, Config);
            var connUrl = await service.GenerateConnectUrlAsync(userId, "sess", "https://nutrition.example.com", default);
            var state = System.Web.HttpUtility.ParseQueryString(new Uri(connUrl.AuthUrl).Query)["state"];
            await service.HandleCallbackAsync("code", state, null, userId, "sess", "https://nutrition.example.com", default);

            // Run Sync
            var syncResult = await service.SyncAsync(userId, default);

            Assert.Equal("connected", syncResult.Status);
            Assert.Equal("fresh", syncResult.Freshness);
            Assert.Equal(31, syncResult.Days.Count);

            // Today should be 8450
            var todayItem = syncResult.Days.Single(d => d.Date == today);
            Assert.Equal(8450, todayItem.Count);

            // Yesterday should be true zero 0
            var yesterdayItem = syncResult.Days.Single(d => d.Date == yesterday);
            Assert.Equal(0, yesterdayItem.Count);

            // Missing date must be null, not 0
            var missingItem = syncResult.Days.Single(d => d.Date == dayBeforeYesterday);
            Assert.Null(missingItem.Count);
        }
    }

    [Fact]
    public async Task Transient_Failure_Returns_Stale_Data()
    {
        var userId = Guid.NewGuid();
        await using (var db = Open(userId))
        {
            db.Users.Add(new AppUser { Id = userId, DisplayName = "stale_user", IdentitySubject = "sub_stale_user" });
            await db.SaveChangesAsync();
        }

        var today = RetentionService.Today(null);
        var mockHttp = new MockHttpHandler
        {
            TokenResponse = new { access_token = "at-fresh", refresh_token = "rt-fresh", expires_in = 3600 },
            TokenInfoResponse = new { sub = "gid-stale" },
            DailyRollupResponse = new
            {
                dataPoints = new object[]
                {
                    new
                    {
                        civilStartTime = new { date = new { year = today.Year, month = today.Month, day = today.Day } },
                        stepsRollupValue = new { countSum = "10500" }
                    }
                }
            }
        };

        await using (var db = Open(userId))
        {
            var service = new GoogleHealthService(new HttpClient(mockHttp), db, kms, Config);
            var connUrl = await service.GenerateConnectUrlAsync(userId, "sess", "https://nutrition.example.com", default);
            var state = System.Web.HttpUtility.ParseQueryString(new Uri(connUrl.AuthUrl).Query)["state"];
            await service.HandleCallbackAsync("code", state, null, userId, "sess", "https://nutrition.example.com", default);

            // Initial successful sync
            var initial = await service.SyncAsync(userId, default);
            Assert.Equal("fresh", initial.Freshness);

            // Make next Google Health call fail with 503
            mockHttp.Simulate503OnRollup = true;

            // Invalidate 2-minute memory cache to force sync attempt
            GoogleHealthService.InvalidateMemoryCache(userId);
            var conn = await db.GoogleHealthConnections.SingleAsync(c => c.UserId == userId);
            conn.LastSyncedAt = DateTime.UtcNow.AddMinutes(-5);
            await db.SaveChangesAsync();

            // Perform sync
            var staleResult = await service.SyncAsync(userId, default);
            Assert.Equal("connected", staleResult.Status);
            Assert.Equal("stale", staleResult.Freshness);
            Assert.NotNull(staleResult.WarningCode);

            // Data should be retained from previous successful sync
            var todayItem = staleResult.Days.Single(d => d.Date == today);
            Assert.Equal(10500, todayItem.Count);
        }
    }

    [Fact]
    public async Task External_Revocation_Deletes_Data_And_Requires_Reconnection()
    {
        var userId = Guid.NewGuid();
        await using (var db = Open(userId))
        {
            db.Users.Add(new AppUser { Id = userId, DisplayName = "revoke_user", IdentitySubject = "sub_revoke_user" });
            await db.SaveChangesAsync();
        }

        var today = RetentionService.Today(null);
        var mockHttp = new MockHttpHandler
        {
            TokenResponse = new { access_token = "at-1", refresh_token = "rt-1", expires_in = 3600 },
            TokenInfoResponse = new { sub = "gid-revoke" },
            DailyRollupResponse = new
            {
                dataPoints = new object[]
                {
                    new
                    {
                        civilStartTime = new { date = new { year = today.Year, month = today.Month, day = today.Day } },
                        stepsRollupValue = new { countSum = "5000" }
                    }
                }
            }
        };

        await using (var db = Open(userId))
        {
            var service = new GoogleHealthService(new HttpClient(mockHttp), db, kms, Config);
            var connUrl = await service.GenerateConnectUrlAsync(userId, "sess", "https://nutrition.example.com", default);
            var state = System.Web.HttpUtility.ParseQueryString(new Uri(connUrl.AuthUrl).Query)["state"];
            await service.HandleCallbackAsync("code", state, null, userId, "sess", "https://nutrition.example.com", default);

            // Successful initial sync
            await service.SyncAsync(userId, default);

            // Now Google reports refresh token is revoked
            mockHttp.SimulateInvalidGrantOnRefresh = true;
            GoogleHealthService.InvalidateMemoryCache(userId);
            var conn = await db.GoogleHealthConnections.SingleAsync(c => c.UserId == userId);
            conn.LastSyncedAt = DateTime.UtcNow.AddMinutes(-5);
            await db.SaveChangesAsync();

            var revokedResult = await service.SyncAsync(userId, default);
            Assert.Equal("reconnect_required", revokedResult.Status);
            Assert.Equal("unavailable", revokedResult.Freshness);
            Assert.Empty(revokedResult.Days);

            // Confirm imported data is removed from database
            var updatedConn = await db.GoogleHealthConnections.SingleAsync(c => c.UserId == userId);
            Assert.Equal("reconnect_required", updatedConn.Status);
            Assert.Empty(updatedConn.EncryptedRefreshToken);
            var decryptedHistory = await kms.DecryptAsync(updatedConn.EncryptedStepHistoryJson, default);
            Assert.Equal("[]", decryptedHistory);
        }
    }

    [Fact]
    public async Task Disconnect_Deletes_Data_And_Revokes_Upstream()
    {
        var userId = Guid.NewGuid();
        await using (var db = Open(userId))
        {
            db.Users.Add(new AppUser { Id = userId, DisplayName = "disc_user", IdentitySubject = "sub_disc_user" });
            await db.SaveChangesAsync();
        }

        var mockHttp = new MockHttpHandler
        {
            TokenResponse = new { access_token = "at-disc", refresh_token = "rt-disc", expires_in = 3600 },
            TokenInfoResponse = new { sub = "gid-disc" }
        };

        await using (var db = Open(userId))
        {
            var service = new GoogleHealthService(new HttpClient(mockHttp), db, kms, Config);
            var connUrl = await service.GenerateConnectUrlAsync(userId, "sess", "https://nutrition.example.com", default);
            var state = System.Web.HttpUtility.ParseQueryString(new Uri(connUrl.AuthUrl).Query)["state"];
            await service.HandleCallbackAsync("code", state, null, userId, "sess", "https://nutrition.example.com", default);

            var connBefore = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId);
            Assert.NotNull(connBefore);

            // Disconnect
            var discResult = await service.DisconnectAsync(userId, default);
            Assert.Equal("disconnected", discResult.Status);
            Assert.True(mockHttp.RevokeCalled);

            // Connection record must be deleted
            var connAfter = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId);
            Assert.Null(connAfter);
        }
    }

    [Fact]
    public async Task Nutrition_SignOut_Preserves_GoogleHealthConnection()
    {
        var userId = Guid.NewGuid();
        var sessionToken = "session-test-token";
        var sessionHash = AuthService.Hash(sessionToken);

        await using (var db = Open(userId))
        {
            db.Users.Add(new AppUser { Id = userId, DisplayName = "signout_user", IdentitySubject = "sub_signout_user" });
            db.Sessions.Add(new Session { Hash = sessionHash, UserId = userId, Expires = DateTime.UtcNow.AddDays(7) });
            await db.SaveChangesAsync();
        }

        var mockHttp = new MockHttpHandler
        {
            TokenResponse = new { access_token = "at-signout", refresh_token = "rt-signout", expires_in = 3600 },
            TokenInfoResponse = new { sub = "gid-signout" }
        };

        await using (var db = Open(userId))
        {
            var service = new GoogleHealthService(new HttpClient(mockHttp), db, kms, Config);
            var connUrl = await service.GenerateConnectUrlAsync(userId, sessionHash, "https://nutrition.example.com", default);
            var state = System.Web.HttpUtility.ParseQueryString(new Uri(connUrl.AuthUrl).Query)["state"];
            await service.HandleCallbackAsync("code", state, null, userId, sessionHash, "https://nutrition.example.com", default);

            // Simulate sign-out (delete session)
            await db.Sessions.Where(s => s.Hash == sessionHash).ExecuteDeleteAsync();

            // Google Health connection must survive
            var conn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId);
            Assert.NotNull(conn);
            Assert.Equal("connected", conn.Status);
        }
    }

    [Fact]
    public async Task Export_Includes_Steps_And_Redacts_Tokens_And_Credentials()
    {
        var userId = Guid.NewGuid();
        await using (var db = Open(userId))
        {
            db.Users.Add(new AppUser { Id = userId, DisplayName = "export_user", IdentitySubject = "sub_export_user" });
            await db.SaveChangesAsync();
        }

        var date1 = new DateOnly(2026, 9, 10);
        var date2 = new DateOnly(2026, 9, 11);

        var daysList = new List<GoogleHealthDay>
        {
            new(date1, 7500),
            new(date2, null)
        };
        var encryptedHistory = await kms.EncryptAsync(JsonSerializer.Serialize(daysList), default);
        var encryptedRt = await kms.EncryptAsync("secret-refresh-token", default);
        var encryptedGid = await kms.EncryptAsync("google-sub-secret", default);

        await using (var db = Open(userId))
        {
            db.GoogleHealthConnections.Add(new GoogleHealthConnection
            {
                UserId = userId,
                GoogleIdHash = "hash123",
                EncryptedGoogleId = encryptedGid,
                EncryptedRefreshToken = encryptedRt,
                EncryptedStepHistoryJson = encryptedHistory,
                ConnectedAt = DateTime.UtcNow,
                Status = "connected",
                Revision = 1
            });
            await db.SaveChangesAsync();
        }

        await using (var db = Open(userId))
        {
            var exportService = new ExportService(db, new RetentionService(db, Config), kms);

            // 1. JSON Export
            var jsonDoc = await exportService.BuildJsonDocument(default);
            Assert.Equal(2, jsonDoc.GoogleHealthSteps.Count);
            Assert.Equal(date1, jsonDoc.GoogleHealthSteps[0].Date);
            Assert.Equal(7500, jsonDoc.GoogleHealthSteps[0].StepCount);
            Assert.Equal(date2, jsonDoc.GoogleHealthSteps[1].Date);
            Assert.Null(jsonDoc.GoogleHealthSteps[1].StepCount);

            var jsonString = JsonSerializer.Serialize(jsonDoc);
            Assert.DoesNotContain("secret-refresh-token", jsonString);
            Assert.DoesNotContain("google-sub-secret", jsonString);
            Assert.DoesNotContain(encryptedRt, jsonString);
            Assert.DoesNotContain(encryptedGid, jsonString);
            Assert.DoesNotContain(encryptedHistory, jsonString);

            // 2. CSV Export
            using var ms = new MemoryStream();
            await exportService.WriteCsvBundle(ms, default);
            ms.Position = 0;
            using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
            var stepsEntry = zip.GetEntry("google-health-steps.csv");
            Assert.NotNull(stepsEntry);

            using var reader = new StreamReader(stepsEntry.Open(), Encoding.UTF8);
            var csvContent = await reader.ReadToEndAsync();
            Assert.Contains("2026-09-10,7500", csvContent);
            Assert.Contains("2026-09-11,", csvContent);
            Assert.DoesNotContain("secret-refresh-token", csvContent);
            Assert.DoesNotContain("google-sub-secret", csvContent);
        }
    }

    private sealed class TestHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Development";
        public string ApplicationName { get; set; } = "Nutrition.Api";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    private sealed class MockHttpHandler : HttpMessageHandler
    {
        public object? TokenResponse { get; set; }
        public object? TokenInfoResponse { get; set; }
        public object? DailyRollupResponse { get; set; }
        public bool Simulate503OnRollup { get; set; }
        public bool SimulateInvalidGrantOnRefresh { get; set; }
        public bool RevokeCalled { get; private set; }
        public string? LastUserInfoAuthorization { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var url = request.RequestUri?.ToString() ?? "";

            if (url.Contains("openidconnect.googleapis.com/v1/userinfo") || url.Contains("oauth2.googleapis.com/tokeninfo"))
            {
                if (url.Contains("openidconnect.googleapis.com/v1/userinfo"))
                    LastUserInfoAuthorization = request.Headers.Authorization?.ToString();
                var json = JsonSerializer.Serialize(TokenInfoResponse ?? new { sub = "default-sub" });
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                });
            }

            if (url.Contains("oauth2.googleapis.com/token"))
            {
                if (SimulateInvalidGrantOnRefresh)
                {
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest)
                    {
                        Content = new StringContent("{\"error\":\"invalid_grant\",\"error_description\":\"Token has been expired or revoked.\"}", Encoding.UTF8, "application/json")
                    });
                }
                var json = JsonSerializer.Serialize(TokenResponse ?? new { access_token = "at-default", refresh_token = "rt-default" });
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                });
            }

            if (url.Contains("dataPoints:dailyRollUp"))
            {
                if (Simulate503OnRollup)
                {
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
                    {
                        Content = new StringContent("Service Unavailable", Encoding.UTF8, "text/plain")
                    });
                }
                var json = JsonSerializer.Serialize(DailyRollupResponse ?? new { dataPoints = Array.Empty<object>() });
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                });
            }

            if (url.Contains("oauth2.googleapis.com/revoke"))
            {
                RevokeCalled = true;
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
}

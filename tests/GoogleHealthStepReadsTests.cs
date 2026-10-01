using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthStepReadsTests
{
    [Fact]
    public async Task Saved_steps_return_without_contacting_the_provider_or_processing_uploads()
    {
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options)
        { CurrentUser = Guid.NewGuid() };
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        db.Users.Add(new AppUser { Id = db.CurrentUser.Value, IdentitySubject = "cached", DisplayName = "Cached" });
        db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = db.CurrentUser.Value, Status = "connected", LastSyncedAt = DateTime.UtcNow.AddHours(-1),
            EncryptedStepHistoryJson = "[{\"date\":\"" + DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd") + "\",\"count\":4321}]"
        });
        await db.SaveChangesAsync();
        var kms = new PlainKms();
        var google = new GoogleHealthService(new HttpClient(new UnexpectedProvider()), db, kms, new ConfigurationBuilder().Build());
        var result = await GoogleHealthStepReads.ReadCachedAsync(google, db, kms, default);
        Assert.Equal("connected", result.Status);
        Assert.Equal("stale", result.Freshness);
        Assert.Contains(result.Days, day => day.Count == 4321);
        Assert.DoesNotContain(result.Days, day => day.Count == 0);
    }

    private sealed class PlainKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string value, CancellationToken ct) => Task.FromResult(value);
        public Task<string> DecryptAsync(string value, CancellationToken ct) => Task.FromResult(value);
    }
    private sealed class UnexpectedProvider : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => throw new InvalidOperationException("Cached steps must not contact Google.");
    }
}

using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nutrition.Api.Data;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthSyncEndpointTests
{
    private const string Token = "scheduler-token";

    [Theory]
    [InlineData(null)]
    [InlineData("wrong-token")]
    public async Task Scheduled_sync_rejects_callers_without_the_scheduler_token(string? presented)
    {
        using var response = await Post(presented);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Scheduled_sync_runs_every_outbound_queue()
    {
        using var response = await Post(Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        foreach (var queue in new[] { "weight", "nutrition", "bodyFat" })
            Assert.Equal(0, body.GetProperty(queue).GetProperty("processed").GetInt32());
    }

    private static async Task<HttpResponseMessage> Post(string? presented)
    {
        var tempDb = Path.Combine(Path.GetTempPath(), $"nutrition-test-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestFactory(tempDb);
            using (var scope = factory.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDb>().Database.EnsureCreatedAsync();
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            using var request = new HttpRequestMessage(HttpMethod.Post, "/internal/google-health-sync");
            if (presented is not null) request.Headers.Add("X-Cleanup-Token", presented);
            return await client.SendAsync(request);
        }
        finally
        {
            try { File.Delete(tempDb); } catch { }
        }
    }

    private sealed class TestFactory(string dbPath) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:SqlitePath"] = dbPath,
                ["PublicOrigin"] = "https://localhost",
                ["Cleanup:Token"] = Token
            }));
        }
    }
}

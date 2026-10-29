using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// `/internal` routes accept a Google identity token from an allow-listed caller, so Cloud Scheduler
/// and Cloud Tasks need no shared secret. The legacy header works only while `Cleanup:Token` is set.
public sealed class InternalOidcTests
{
    private const string Audience = "https://nutrition.example.test";
    private const string Caller = "nutrition-internal@project.iam.gserviceaccount.com";

    [Fact]
    public async Task Allow_listed_caller_with_a_valid_identity_token_is_accepted() =>
        Assert.Equal(HttpStatusCode.OK, await Post("caller-token"));

    [Theory]
    [InlineData("stranger-token")]
    [InlineData("forged-token")]
    [InlineData(null)]
    public async Task Other_callers_are_refused(string? bearer) =>
        Assert.Equal(HttpStatusCode.Unauthorized, await Post(bearer));

    [Fact]
    public async Task Missing_audience_configuration_fails_closed() =>
        Assert.Equal(HttpStatusCode.Unauthorized, await Post("caller-token", audience: null));

    [Fact]
    public async Task Legacy_header_is_refused_once_the_secret_is_not_configured()
    {
        var status = await Post(bearer: null, legacyHeader: "old-token", legacyConfigured: false);
        Assert.Equal(HttpStatusCode.Unauthorized, status);
    }

    [Fact]
    public async Task Legacy_header_still_works_while_the_secret_is_configured()
    {
        var status = await Post(bearer: null, legacyHeader: "old-token", legacyConfigured: true);
        Assert.Equal(HttpStatusCode.OK, status);
    }

    private static async Task<HttpStatusCode> Post(string? bearer, string? audience = Audience,
        string? legacyHeader = null, bool legacyConfigured = false)
    {
        var tempDb = Path.Combine(Path.GetTempPath(), $"nutrition-oidc-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestFactory(tempDb, audience, legacyConfigured);
            using (var scope = factory.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDb>().Database.EnsureCreatedAsync();
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            using var request = new HttpRequestMessage(HttpMethod.Post, "/internal/google-health-sync");
            if (bearer is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            if (legacyHeader is not null) request.Headers.Add("X-Cleanup-Token", legacyHeader);
            using var response = await client.SendAsync(request);
            return response.StatusCode;
        }
        finally
        {
            try { File.Delete(tempDb); } catch { }
        }
    }

    private sealed class TestFactory(string dbPath, string? audience, bool legacyConfigured) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                var values = new Dictionary<string, string?>
                {
                    ["Database:SqlitePath"] = dbPath,
                    ["PublicOrigin"] = "https://localhost",
                    ["Internal:AllowedCallers"] = $"{Caller}, operator@example.test",
                };
                if (audience is not null) values["Internal:Audience"] = audience;
                if (legacyConfigured) values["Cleanup:Token"] = "old-token";
                config.AddInMemoryCollection(values);
            });
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IInternalTokenVerifier>();
                services.AddSingleton<IInternalTokenVerifier, FakeVerifier>();
            });
        }
    }

    private sealed class FakeVerifier : IInternalTokenVerifier
    {
        public Task<string?> VerifiedEmail(string token, string audience, CancellationToken ct) =>
            Task.FromResult<string?>(audience != Audience ? null : token switch
            {
                "caller-token" => Caller,
                "stranger-token" => "stranger@example.test",
                _ => null,
            });
    }
}

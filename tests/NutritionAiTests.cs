using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class NutritionAiTests
{
    [Fact]
    public async Task Analyze_trims_shared_secret_and_accepts_missing_usage()
    {
        string? authorization = null;
        string? requestBody = null;
        using var client = new HttpClient(new Handler(request =>
        {
            authorization = request.Headers.Authorization?.ToString();
            requestBody = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""
                    {"status":"completed","output":[{"content":[{"type":"output_text","text":"{\"foods\":[{\"name\":\"Banana\",\"quantity\":1,\"unit\":\"serving\",\"calories\":100,\"protein\":null,\"fat\":null,\"carbs\":23,\"fiber\":3,\"notes\":\"One serving\"}],\"questions\":[],\"explanation\":\"Review the portion.\"}"}]}]}
                    """)
            };
        }));
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
        {
            ["OpenAi:ApiKey"] = " shared-key\r\n",
            ["OpenAi:Model"] = " test-model\n"
        }).Build();

        var result = await new NutritionAi(client, config).Analyze("description", "One banana", null, default);

        Assert.Equal("Bearer shared-key", authorization);
        using var request = JsonDocument.Parse(requestBody!);
        Assert.Equal("test-model", request.RootElement.GetProperty("model").GetString());
        Assert.Single(result.Draft.Foods);
        Assert.Equal(0, result.InputTokens);
        Assert.Equal(0, result.OutputTokens);
    }

    [Fact]
    public async Task Analyze_accepts_the_flat_shared_financial_app_key_name()
    {
        using var client = new HttpClient(new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""
                {"status":"completed","output":[{"content":[{"type":"output_text","text":"{\"foods\":[],\"questions\":[\"What portion?\"],\"explanation\":\"Review the portion.\"}"}]}],"usage":{"input_tokens":2,"output_tokens":3}}
                """)
        }));
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
        {
            ["OpenAiApiKey"] = " shared-key "
        }).Build();

        var result = await new NutritionAi(client, config).Analyze("description", "Rice", null, default);

        Assert.Empty(result.Draft.Foods);
        Assert.Equal(2, result.InputTokens);
        Assert.Equal(3, result.OutputTokens);
    }

    private sealed class Handler(Func<HttpRequestMessage,HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(respond(request));
    }
}

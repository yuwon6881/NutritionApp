using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record OpenAiReply(string Text,long InputTokens,long OutputTokens,long CachedInputTokens);

/// Shared OpenAI Responses plumbing: key and model resolution, one strict-JSON request, and
/// output/usage parsing. NutritionAi still carries its own copy; move it here when that file
/// is next changed so both callers share one contract.
public static class OpenAiResponses
{
    public static async Task<OpenAiReply> Send(HttpClient http,IConfiguration config,string instructions,string cacheKey,
        IReadOnlyList<object> content,string schemaName,JsonElement schema,string unavailable,string noResult,CancellationToken ct)
    {
        // Secret Manager payloads commonly include a trailing newline; accept the shared flat key name too.
        var key=(config["OpenAi:ApiKey"]??string.Empty).Trim();
        if(string.IsNullOrWhiteSpace(key))key=(config["OpenAiApiKey"]??string.Empty).Trim();
        Validation.Require(!string.IsNullOrWhiteSpace(key),unavailable,503);
        Validation.Require(!key.Any(char.IsWhiteSpace),unavailable,503);
        var model=(config["OpenAi:Model"]??string.Empty).Trim();
        if(string.IsNullOrWhiteSpace(model))model=(config["OpenAiModel"]??"gpt-5.4-mini").Trim();
        if(string.IsNullOrWhiteSpace(model))model="gpt-5.4-mini";
        var body=new Dictionary<string,object?>
        {
            ["model"]=model,["store"]=false,["prompt_cache_key"]=cacheKey,
            // Reasoning tokens count toward the output limit; leave room for them and the JSON.
            ["max_output_tokens"]=config.GetValue("OpenAi:MaxOutputTokens",16000),
            ["instructions"]=instructions,
            ["input"]=new[] {new {role="user",content}},
            ["text"]=new {format=new {type="json_schema",name=schemaName,strict=true,schema}}
        };
        // Only reasoning models accept the parameter, so an empty setting omits it.
        var effort=(config["OpenAi:ReasoningEffort"]??"medium").Trim();
        if(effort.Length>0)body["reasoning"]=new {effort};
        using var request=new HttpRequestMessage(HttpMethod.Post,"https://api.openai.com/v1/responses");
        request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",key);
        request.Content=new StringContent(Json.Write(body),Encoding.UTF8,"application/json");
        using var response=await http.SendAsync(request,ct);
        Validation.Require(response.IsSuccessStatusCode,"AI could not process this request. Try again later.",503);
        using var document=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var root=document.RootElement;
        Validation.Require(root.TryGetProperty("status",out var status)&&status.GetString()=="completed",noResult,422);
        var output=new StringBuilder();
        if(root.TryGetProperty("output",out var items)&&items.ValueKind==JsonValueKind.Array)
            foreach(var item in items.EnumerateArray())
                if(item.TryGetProperty("content",out var parts)&&parts.ValueKind==JsonValueKind.Array)
                    foreach(var part in parts.EnumerateArray())
                        if(part.TryGetProperty("type",out var type)&&type.GetString()=="output_text"&&part.TryGetProperty("text",out var text))output.Append(text.GetString());
        // A refusal arrives as a completed response without output text.
        Validation.Require(output.Length>0,noResult,422);
        return new(output.ToString(),Usage(root,"input_tokens"),Usage(root,"output_tokens"),CachedUsage(root));
    }

    private static long Usage(JsonElement root,string name)
        =>root.TryGetProperty("usage",out var usage)&&usage.ValueKind==JsonValueKind.Object
          &&usage.TryGetProperty(name,out var value)&&value.TryGetInt64(out var count)?count:0;

    private static long CachedUsage(JsonElement root)
        =>root.TryGetProperty("usage",out var usage)&&usage.ValueKind==JsonValueKind.Object
          &&usage.TryGetProperty("input_tokens_details",out var details)&&details.ValueKind==JsonValueKind.Object
          &&details.TryGetProperty("cached_tokens",out var cached)&&cached.TryGetInt64(out var count)?count:0;
}

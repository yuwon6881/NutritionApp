using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record BodyCompositionContext(string? Sex,int? Age,double? HeightCm,double? ScaleKg,double? TrendKg,
    double? FormulaPercent,IReadOnlyList<KeyValuePair<string,double>> Measurements);
public sealed record BodyCompositionPhotos(byte[] Front,byte[] Side,byte[] Back);
public sealed record AiBodyFat(bool Assessable,double? EstimatePercent,double? LowPercent,double? HighPercent,
    string Confidence,string Explanation,List<string> Cues);
public sealed record BodyCompositionResult(AiBodyFat Estimate,long InputTokens,long OutputTokens,long CachedInputTokens);

public sealed class BodyCompositionAi(HttpClient http,IConfiguration config)
{
    public const string Unusable="The photos could not be assessed. Use clear, well-lit front, side, and back photos.";

    public async Task<BodyCompositionResult> Estimate(BodyCompositionPhotos photos,BodyCompositionContext context,CancellationToken ct)
    {
        var content=new List<object> {new {type="input_text",text=BodyCompositionAiPrompt.RequestText(context)}};
        foreach(var image in new[] {photos.Front,photos.Side,photos.Back})
            content.Add(new {type="input_image",image_url="data:image/jpeg;base64,"+Convert.ToBase64String(image),detail="high"});
        var reply=await OpenAiResponses.Send(http,config,BodyCompositionAiPrompt.Instructions,BodyCompositionAiPrompt.CacheKey,content,
            "body_fat_estimate",BodyCompositionAiPrompt.Schema,"AI is not configured. You can still enter body fat yourself.",Unusable,ct);
        AiBodyFat estimate;
        try{estimate=Json.Read<AiBodyFat>(reply.Text);}
        catch(System.Text.Json.JsonException){throw new DomainException(Unusable,422);}
        Validate(estimate);
        return new(Round(estimate),reply.InputTokens,reply.OutputTokens,reply.CachedInputTokens);
    }

    public static void Validate(AiBodyFat estimate)
    {
        Validation.Require(estimate.Assessable,Unusable,422);
        const string invalid="AI returned an estimate outside the expected range. Try again or enter body fat yourself.";
        Validation.Require(estimate is {EstimatePercent:{} value,LowPercent:{} low,HighPercent:{} high}
            &&double.IsFinite(value)&&double.IsFinite(low)&&double.IsFinite(high)
            &&value is >=3 and <=60&&low>=2&&high<=65&&low<=value&&value<=high&&high-low<=15,invalid,422);
        Validation.Require(estimate.Confidence is "low" or "medium" or "high",invalid,422);
        Validation.Require(!string.IsNullOrWhiteSpace(estimate.Explanation)&&estimate.Explanation.Length<=1000,invalid,422);
        Validation.Require(estimate.Cues is {Count:<=6}&&estimate.Cues.All(cue=>!string.IsNullOrWhiteSpace(cue)&&cue.Length<=200),invalid,422);
    }

    private static AiBodyFat Round(AiBodyFat estimate)=>estimate with
    {
        EstimatePercent=Math.Round(estimate.EstimatePercent!.Value,1),
        LowPercent=Math.Round(estimate.LowPercent!.Value,1),
        HighPercent=Math.Round(estimate.HighPercent!.Value,1),
        Explanation=estimate.Explanation.Trim(),
        Cues=estimate.Cues.Select(cue=>cue.Trim()).ToList()
    };
}

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Nutrition.Api.Services.FoodLookup;

public record FoodPortion(string Label,double Grams);

/// <summary>
/// The one provider-neutral result contract the web client reads. Nutrients are per 100 g, portions
/// are in grams, and a nutrient the provider did not report stays null rather than zero.
/// <see cref="IsGeneric"/> marks an unbranded catalogue food for ranking and never leaves the server.
/// </summary>
public record FoodResult(string Name,double Calories,double? Protein,double? Fat,double? Carbs,double? Fiber,string Source,double ServingGrams=100,IReadOnlyList<FoodPortion>? Portions=null,string? Code=null,double? ServingCalories=null,string Basis="per100g",[property:JsonIgnore] bool IsGeneric=false);

/// <summary>Shared shaping rules every provider applies to the result it builds.</summary>
public static class FoodResults
{
    private const int MaxNameLength=160;

    /// <summary>
    /// Food names repeat heavily across brands—one query returns three products called
    /// "Nasi Goreng"—so the leading brand joins the name to keep a result list distinguishable.
    /// </summary>
    public static string Label(string name,string? brands)
    {
        var brand=brands?.Split(',')[0].Trim();
        var label=string.IsNullOrEmpty(brand)||name.Contains(brand,StringComparison.OrdinalIgnoreCase)?name:name+" · "+brand;
        return label.Length<=MaxNameLength?label:label[..MaxNameLength].TrimEnd();
    }

    public static double? ServingCalories(double calories,IReadOnlyList<FoodPortion> portions)
        =>portions.FirstOrDefault() is { } portion?calories*portion.Grams/100:null;

    public static IReadOnlyList<FoodPortion> LimitPortions(IEnumerable<FoodPortion> portions)
    {
        var result=new List<FoodPortion>();
        var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var portion in portions)
        {
            var label=portion.Label.Trim();
            if(label.Length is < 1 or > 24||!double.IsFinite(portion.Grams)||portion.Grams is < .1 or > 10000)continue;
            if(!seen.Add(label))continue;
            result.Add(new FoodPortion(label,portion.Grams));
            if(result.Count==12)break;
        }
        return result;
    }

    public static IReadOnlyList<FoodPortion> ParseStoredPortions(string json)
    {
        try
        {
            using var document=JsonDocument.Parse(json);
            if(document.RootElement.ValueKind!=JsonValueKind.Array)return [];
            var portions=new List<FoodPortion>();
            foreach(var item in document.RootElement.EnumerateArray())
            {
                if(item.ValueKind!=JsonValueKind.Object||!item.TryGetProperty("label",out var label)||label.ValueKind!=JsonValueKind.String||!item.TryGetProperty("grams",out var grams)||!TryNumber(grams,out var value))continue;
                portions.Add(new FoodPortion(label.GetString()??"",value));
            }
            return LimitPortions(portions);
        }
        catch(JsonException){return [];}
    }

    /// <summary>
    /// Fits a provider's serving description to the 24-character portion chip: parenthetical detail
    /// goes first, then anything after a comma. A description that still does not fit, or is only a
    /// metric amount the editor already offers ("100 g"), yields null rather than a cut-off word.
    /// </summary>
    public static string? PortionLabel(string description)
    {
        static string Clean(string value)=>System.Text.RegularExpressions.Regex.Replace(value,@"\s+"," ").Trim().TrimEnd(',',';').Trim();
        var plain=System.Text.RegularExpressions.Regex.Replace(description,@"\([^)]*\)","");
        foreach(var candidate in new[]{Clean(description),Clean(plain),Clean(plain.Split(',')[0])})
        {
            if(candidate.Length is 0 or > 24)continue;
            return System.Text.RegularExpressions.Regex.IsMatch(candidate,@"^[\d.,\s]*(g|ml|oz|fl oz)?$",System.Text.RegularExpressions.RegexOptions.IgnoreCase)?null:candidate;
        }
        return null;
    }

    public static bool TryNumber(JsonElement value,out double number)
    {
        if(value.ValueKind==JsonValueKind.Number&&value.TryGetDouble(out number))return true;
        if(value.ValueKind==JsonValueKind.String&&double.TryParse(value.GetString(),NumberStyles.Float,CultureInfo.InvariantCulture,out number))return true;
        number=0;
        return false;
    }

    public static string? Text(JsonElement element,string name)=>
        element.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.String
        &&value.GetString()?.Trim() is {Length:>0} text?text:null;

    public static double? Number(JsonElement element,string name)=>
        element.TryGetProperty(name,out var value)&&TryNumber(value,out var number)?number:null;
}

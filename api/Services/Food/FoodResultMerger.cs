namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Combines per-provider search answers into one ranked list. Pure: no HTTP, no cache. Answers
/// arrive in configured search order, which is also the priority when two providers agree.
/// </summary>
public static class FoodResultMerger
{
    public const int MaxResults=20;
    // Two providers describing the same plain food rarely agree to the calorie; within this share
    // of the larger value they are the same food for a diary.
    private const double SameFoodCalorieTolerance=.05;

    public static IReadOnlyList<FoodResult> Merge(IReadOnlyList<(IFoodProvider Provider,IReadOnlyList<FoodResult> Results)> answers,string query)
    {
        var kept=new List<(FoodResult Result,int Provider)>();
        for(var provider=0;provider<answers.Count;provider++)
            foreach(var result in answers[provider].Results)
                Add(kept,result,provider);
        return FoodRanking.PrioritizeResults(kept.Select(item=>item.Result),query).Take(MaxResults).ToArray();
    }

    private static void Add(List<(FoodResult Result,int Provider)> kept,FoodResult result,int provider)
    {
        var gtin=NormalizeGtin(result.Code);
        for(var index=0;index<kept.Count;index++)
        {
            var existing=kept[index];
            if(gtin is not null&&gtin==NormalizeGtin(existing.Result.Code))
            {
                if(Richness(result)>Richness(existing.Result))kept[index]=(result,provider);
                return;
            }
            // Name matching is only for agreement across providers: one provider listing two
            // "Nasi Goreng" rows means two products, not a duplicate.
            if(existing.Provider!=provider&&SameFood(existing.Result,result))return;
        }
        kept.Add((result,provider));
    }

    /// <summary>
    /// GTIN-14, EAN-13 and UPC-A spell one product with different leading zeros, so the comparison
    /// ignores them. Anything that is not all digits is not a barcode.
    /// </summary>
    public static string? NormalizeGtin(string? code)
    {
        if(code is not {Length:>0}||!code.All(char.IsAsciiDigit))return null;
        var trimmed=code.TrimStart('0');
        return trimmed.Length==0?null:trimmed;
    }

    private static bool SameFood(FoodResult left,FoodResult right)
    {
        var leftKey=NameKey(left.Name);
        if(leftKey.Count==0||!leftKey.SetEquals(NameKey(right.Name)))return false;
        var larger=Math.Max(left.Calories,right.Calories);
        return larger<=0||Math.Abs(left.Calories-right.Calories)<=larger*SameFoodCalorieTolerance;
    }

    // Words catalogues add to a plain food without changing what it is.
    private static readonly HashSet<string> Descriptors=new(StringComparer.Ordinal){"raw","fresh","plain"};

    /// <summary>
    /// "Bananas, raw", "Banana" and "Rice, white, cooked" / "Cooked white rice" name one food each,
    /// so names compare as sets of singular words without descriptors. The brand after " · " stays
    /// part of the name, and the calorie check still separates raw from cooked or whole from skim.
    /// </summary>
    private static HashSet<string> NameKey(string name)
        =>FoodRanking.Stems(name).Where(word=>!Descriptors.Contains(word)).ToHashSet(StringComparer.Ordinal);

    /// <summary>Known nutrients, a gram serving and a verified basis each make a record more useful.</summary>
    private static int Richness(FoodResult result)
        =>new double?[]{result.Protein,result.Fat,result.Carbs,result.Fiber}.Count(value=>value is not null)
            +(result.Portions?.Count>0?1:0)
            +(result.Basis=="per100g"?1:0);
}

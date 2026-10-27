namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// One searchable row of a dataset bundled with the API. <see cref="LeadSegmentLength"/> counts the
/// stems of the part of the name that says what the food is: the first comma segment of a USDA name
/// ("Rice" in "Rice, white, cooked"), or a product's own name before its brand.
/// </summary>
public sealed record BundledFood(FoodResult Result,string[] Stems,int LeadSegmentLength);

/// <summary>Word matching shared by the bundled datasets; searching never leaves the process.</summary>
public static class BundledFoodSearch
{
    public static IReadOnlyList<FoodResult> Search(IReadOnlyList<BundledFood> foods,string query,int maxResults)
    {
        var wanted=FoodRanking.Stems(query);
        if(wanted.Length==0)return [];
        var matches=new List<(BundledFood Food,Score Score)>();
        foreach(var food in foods)
            if(Match(food,wanted) is { } score)matches.Add((food,score));
        return matches
            .OrderBy(match=>match.Score)
            .Take(maxResults)
            .Select(match=>match.Food.Result)
            .ToArray();
    }

    /// <summary>
    /// Lower sorts first: a food whose leading word is one the person typed ("Bananas, raw") beats
    /// one that only mentions it ("Bread, banana"); whole-word matches beat prefixes ("egg" is not
    /// "eggplant"); a leading segment made only of typed words ("Rice, white, cooked") beats one
    /// with extra words ("Rice cake", "Rice flour"), which are other foods; words in the leading
    /// segment beat preparation details and brands; shorter names win.
    /// </summary>
    private readonly record struct Score(int Lead,int Extra,int Prefixed,int OutsideLead,int Length):IComparable<Score>
    {
        public int CompareTo(Score other)
        {
            var result=Lead.CompareTo(other.Lead);
            if(result==0)result=Extra.CompareTo(other.Extra);
            if(result==0)result=Prefixed.CompareTo(other.Prefixed);
            if(result==0)result=OutsideLead.CompareTo(other.OutsideLead);
            return result!=0?result:Length.CompareTo(other.Length);
        }
    }

    private static Score? Match(BundledFood food,string[] wanted)
    {
        if(food.Stems.Length==0)return null;
        var prefixed=0;
        var outsideLead=0;
        foreach(var token in wanted)
        {
            var exact=Array.IndexOf(food.Stems,token);
            if(exact<0)
            {
                exact=Array.FindIndex(food.Stems,stem=>stem.StartsWith(token,StringComparison.Ordinal));
                if(exact<0)return null;
                prefixed++;
            }
            if(exact>=food.LeadSegmentLength)outsideLead++;
        }
        var lead=Array.IndexOf(wanted,food.Stems[0])>=0?0:1;
        return new Score(lead,Math.Max(0,food.LeadSegmentLength-wanted.Length),prefixed,outsideLead,food.Stems.Length);
    }
}

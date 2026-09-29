namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Plain whole foods and common dishes ("banana", "cooked white rice") from the bundled USDA
/// dataset. It answers instantly, without quota, and keeps search useful when every network
/// provider is shedding load.
/// </summary>
public sealed class UsdaGenericProvider(UsdaGenericDataset dataset):IFoodProvider
{
    public const string ProviderId="usda";
    public const string Attribution="USDA FoodData Central";
    private const int MaxResults=10;

    public string Id=>ProviderId;
    public string Name=>Attribution;
    public FoodCapability Capabilities=>FoodCapability.Search;
    public bool IsLocal=>true;

    public Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)
    {
        var wanted=FoodRanking.Stems(query);
        if(wanted.Length==0)return Task.FromResult<IReadOnlyList<FoodResult>>([]);
        var matches=new List<(UsdaGenericDataset.Entry Entry,Score Score)>();
        foreach(var entry in dataset.Entries)
            if(Match(entry,wanted) is { } score)matches.Add((entry,score));
        IReadOnlyList<FoodResult> results=matches
            .OrderBy(match=>match.Score)
            .Take(MaxResults)
            .Select(match=>match.Entry.Result)
            .ToArray();
        return Task.FromResult(results);
    }

    public Task<FoodResult?> Barcode(string code,CancellationToken ct)=>Task.FromResult<FoodResult?>(null);

    /// <summary>
    /// Lower sorts first: a food whose leading word is one the person typed ("Bananas, raw") beats
    /// one that only mentions it ("Bread, banana"); whole-word matches beat prefixes ("egg" is not
    /// "eggplant"); words in the first comma segment beat preparation details; shorter names win.
    /// </summary>
    private readonly record struct Score(int Lead,int Prefixed,int OutsideLead,int Length):IComparable<Score>
    {
        public int CompareTo(Score other)
        {
            var result=Lead.CompareTo(other.Lead);
            if(result==0)result=Prefixed.CompareTo(other.Prefixed);
            if(result==0)result=OutsideLead.CompareTo(other.OutsideLead);
            return result!=0?result:Length.CompareTo(other.Length);
        }
    }

    private static Score? Match(UsdaGenericDataset.Entry entry,string[] wanted)
    {
        var prefixed=0;
        var outsideLead=0;
        foreach(var token in wanted)
        {
            var exact=Array.IndexOf(entry.Stems,token);
            if(exact<0)
            {
                exact=Array.FindIndex(entry.Stems,stem=>stem.StartsWith(token,StringComparison.Ordinal));
                if(exact<0)return null;
                prefixed++;
            }
            if(exact>=entry.LeadSegmentLength)outsideLead++;
        }
        var lead=Array.IndexOf(wanted,entry.Stems[0])>=0?0:1;
        return new Score(lead,prefixed,outsideLead,entry.Stems.Length);
    }
}

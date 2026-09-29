using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>Name relevance, serving and personal-frequency ordering shared by every provider.</summary>
public static class FoodRanking
{
    /// <summary>
    /// Keeps name relevance ahead of personal frequency, then prefers a declared gram serving and
    /// the incoming order. Frequency is counted from logged diary entries and only breaks equivalent
    /// name matches, so personalization cannot make a weakly related result outrank a better match.
    /// Open Food Facts' search index has no serving fields, so this must run after hydration.
    /// </summary>
    public static IReadOnlyList<FoodResult> PrioritizeResults(IEnumerable<FoodResult> results,string query,IReadOnlyDictionary<string,int>? frequencies=null)
    {
        var list=results as IReadOnlyList<FoodResult>??results.ToArray();
        var needle=NormalizeSearchText(query);
        var queryTokens=SearchTokens(query);
        var preference=KindPreference(list,queryTokens);
        return list
            .Select((result,index)=>new
            {
                result,
                index,
                nameRank=SearchNameRank(result.Name,needle,queryTokens),
                frequency=Frequency(result,frequencies),
                hasServing=result.Portions?.Count>0,
            })
            // Exact and prefix matches form one tier so the generic/branded preference can order
            // "Bananas, raw" against "Banana · Dole"; weaker name matches never jump that tier.
            .OrderBy(item=>item.nameRank<=1?0:item.nameRank)
            .ThenBy(item=>preference(item.result))
            .ThenBy(item=>item.nameRank)
            .ThenByDescending(item=>item.frequency)
            .ThenByDescending(item=>item.hasServing)
            .ThenBy(item=>item.index)
            .Select(item=>item.result)
            .ToArray();
    }

    private const int GenericQueryMaxTokens=3;

    /// <summary>
    /// A short query that names no brand ("banana", "white rice") wants the plain food first; a
    /// query containing a brand from the results ("dole banana") wants that product first. Lists
    /// with only one kind of result keep their order.
    /// </summary>
    private static Func<FoodResult,int> KindPreference(IReadOnlyList<FoodResult> results,IReadOnlyList<string> queryTokens)
    {
        if(!results.Any(result=>result.IsGeneric)||results.All(result=>result.IsGeneric))return _=>0;
        var brandTokens=results.Where(result=>!result.IsGeneric)
            .Select(result=>result.Name.Split(" · ",2,StringSplitOptions.None))
            .Where(parts=>parts.Length==2)
            .SelectMany(parts=>SearchTokens(parts[1]))
            .ToHashSet(StringComparer.Ordinal);
        if(queryTokens.Any(brandTokens.Contains))return result=>result.IsGeneric?1:0;
        if(queryTokens.Count<=GenericQueryMaxTokens)return result=>result.IsGeneric?0:1;
        return _=>0;
    }

    /// <summary>
    /// Applies account-specific food frequency to a provider-neutral list. The provider cache stays
    /// shared and unpersonalized; only this final ordering reads the account's non-deleted diary.
    /// </summary>
    public static async Task<IReadOnlyList<FoodResult>> RankForUser(IReadOnlyList<FoodResult> results,string query,AppDb db,CancellationToken ct)
    {
        if(results.Count==0)return results;
        var frequency=await UsageCounts(results,db,ct);
        return PrioritizeResults(results,query,frequency);
    }

    /// <summary>
    /// A product with a code keeps its identity even when its display name is edited after logging.
    /// Code-bearing sources include that code; code-less results fall back to their normalized
    /// source and name. This lets old diary rows contribute without a schema migration.
    /// </summary>
    public static string UsageKey(FoodResult result)
        =>result.Code is {Length:>0}
            ? "code:"+result.Source
            : NameUsageKey(result.Source,result.Name);

    /// <summary>Lower is better: 0 exact, 1 prefix, 2 contains, 3 all tokens, 4+ partial, 100 none.</summary>
    public static int SearchNameRank(string name,string query)
        =>SearchNameRank(name,NormalizeSearchText(query),SearchTokens(query));

    public static string[] SearchTokens(string value)
        =>value.Split([' ','-','_','/',',','.','(',')','[',']',':',';'],StringSplitOptions.RemoveEmptyEntries)
            .Select(NormalizeSearchText)
            .Where(token=>token.Length>0)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

    /// <summary>
    /// Normalized tokens with a light plural fold, so "tomato" finds "Tomatoes" and "eggs" finds
    /// "Egg". Only a trailing s (or the oes of potatoes) is removed; "glass" and "cheese" stay whole.
    /// </summary>
    public static string[] Stems(string text)=>SearchTokens(text).Select(Stem).ToArray();

    private static string Stem(string token)
    {
        if(token.Length>4&&token.EndsWith("oes",StringComparison.Ordinal))return token[..^2];
        if(token.Length>3&&token.EndsWith('s')&&!token.EndsWith("ss",StringComparison.Ordinal))return token[..^1];
        return token;
    }

    public static string NormalizeSearchText(string value)
        =>new string(value.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());

    private static int SearchNameRank(string name,string needle,IReadOnlyList<string> queryTokens)
    {
        var candidateText=name.Split(" · ",2,StringSplitOptions.None)[0];
        var candidate=NormalizeSearchText(candidateText);
        if(needle.Length==0||candidate.Length==0)return 0;
        if(string.Equals(candidate,needle,StringComparison.Ordinal))return 0;
        if(candidate.StartsWith(needle,StringComparison.Ordinal))return 1;
        if(candidate.Contains(needle,StringComparison.Ordinal))return 2;
        var candidateTokens=SearchTokens(candidateText);
        var matched=queryTokens.Count(token=>candidateTokens.Contains(token,StringComparer.Ordinal));
        return matched==queryTokens.Count?3:matched>0?4+(queryTokens.Count-matched):100;
    }

    private static int Frequency(FoodResult result,IReadOnlyDictionary<string,int>? frequencies)
        =>frequencies is not null&&frequencies.TryGetValue(UsageKey(result),out var count)?count:0;

    private static string NameUsageKey(string source,string name)
        =>"name:"+source+"\u001f"+NormalizeSearchText(name);

    private static async Task<IReadOnlyDictionary<string,int>> UsageCounts(IReadOnlyList<FoodResult> results,AppDb db,CancellationToken ct)
    {
        var sources=results.Select(result=>result.Source).Distinct(StringComparer.Ordinal).ToArray();
        if(sources.Length==0)return new Dictionary<string,int>(StringComparer.Ordinal);

        var sourceCounts=await db.Entries.AsNoTracking()
            .Where(entry=>!entry.Deleted&&sources.Contains(entry.Source))
            .GroupBy(entry=>entry.Source)
            .Select(group=>new {Source=group.Key,Count=group.Count()})
            .ToDictionaryAsync(row=>row.Source,row=>row.Count,StringComparer.Ordinal,ct);
        // Group in SQL first, then normalize the relatively small set of distinct
        // names. This avoids materializing every historical diary row for ranking.
        var distinctNames=await db.Entries.AsNoTracking()
            .Where(entry=>!entry.Deleted&&sources.Contains(entry.Source))
            .GroupBy(entry=>new {entry.Source,entry.Name})
            .Select(group=>new {group.Key.Source,group.Key.Name,Count=group.Count()})
            .ToListAsync(ct);
        var nameCounts=new Dictionary<string,int>(StringComparer.Ordinal);
        foreach(var entry in distinctNames)
        {
            var key=NameUsageKey(entry.Source,entry.Name);
            nameCounts[key]=nameCounts.GetValueOrDefault(key)+entry.Count;
        }
        var resultCounts=new Dictionary<string,int>(StringComparer.Ordinal);
        foreach(var result in results)
        {
            var count=result.Code is {Length:>0}
                ? sourceCounts.GetValueOrDefault(result.Source)
                : nameCounts.GetValueOrDefault(NameUsageKey(result.Source,result.Name));
            resultCounts[UsageKey(result)]=count;
        }
        return resultCounts;
    }
}

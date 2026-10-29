using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>Name relevance, serving and personal-frequency ordering shared by every provider.</summary>
public static class FoodRanking
{
    /// <summary>
    /// Foods this account has logged lead when their name or brand carries every word of a query of
    /// two or more words: searching again for something already eaten finds it first, most-logged
    /// first. With one word only a plain food leads ("banana" puts a logged "Banana" first, not a
    /// logged "Banana smoothie"), because a single word names too many foods for a past meal to
    /// outrank the food itself. The rest keep name relevance ahead of personal frequency, then
    /// prefer a declared gram serving and the incoming order. The foods the query names come first
    /// ("rice" lists "White rice" and "Rice, brown, cooked" before "Rice cake" and "Rice flour",
    /// which only start with the word), and among those the foods this account has logged lead.
    /// A logged food matching only some of the words stays in its relevance tier, so personalization
    /// cannot make a weakly related result outrank a better match.
    /// Providers also return loose matches that share no word with the query (a fuzzy search can
    /// answer "sunglo" with unrelated dishes); once any result does match, those are dropped. When none
    /// match, the provider's own fuzzy answer is all there is and the list is kept.
    /// </summary>
    public static IReadOnlyList<FoodResult> PrioritizeResults(IEnumerable<FoodResult> results,string query,IReadOnlyDictionary<string,int>? frequencies=null)
    {
        var list=results as IReadOnlyList<FoodResult>??results.ToArray();
        var needle=NormalizeSearchText(query);
        var queryTokens=SearchTokens(query);
        var ranked=list
            .Select((result,index)=>new
            {
                result,
                index,
                nameRank=SearchNameRank(result.Name,needle,queryTokens),
                isPlain=IsPlainFood(result.Name,queryTokens),
                frequency=Frequency(result,frequencies),
                hasServing=result.Portions?.Count>0,
            })
            .ToArray();
        if(ranked.Any(item=>item.nameRank<NoMatch))ranked=ranked.Where(item=>item.nameRank<NoMatch).ToArray();
        var preference=KindPreference(ranked.Select(item=>item.result).ToArray(),queryTokens);
        return ranked
            // The foods the query names form the first tier; exact and prefix matches share the
            // next, so a food that merely starts with the word stays behind them. Weaker name
            // matches never jump a tier.
            .OrderBy(item=>item.frequency>0&&item.nameRank<=AllTokensRank&&(queryTokens.Length>1||item.isPlain)?0:1)
            .ThenBy(item=>item.isPlain&&item.nameRank<=AllTokensRank?0:item.nameRank<=1?1:item.nameRank)
            .ThenByDescending(item=>item.frequency)
            .ThenBy(item=>preference(item.result))
            .ThenBy(item=>item.nameRank)
            .ThenByDescending(item=>item.hasServing)
            .ThenBy(item=>item.index)
            .Select(item=>item.result)
            .ToArray();
    }

    private const int GenericQueryMaxTokens=3;
    private const int NoMatch=100;
    private const int AllTokensRank=3;

    /// <summary>
    /// True when the name's leading phrase (before a comma or the brand) is what the query asks
    /// for: it uses only words the person typed ("Rice, white, cooked" for "white rice"), or it
    /// ends in the typed noun ("White rice", "Banana" for "rice", "banana"). "Rice cake", "Rice
    /// flour" and "Banana smoothie" lead with the word but name another food.
    /// </summary>
    private static bool IsPlainFood(string name,IReadOnlyList<string> queryTokens)
    {
        var lead=SearchTokens(name.Split(" · ",2,StringSplitOptions.None)[0].Split(',')[0]);
        if(lead.Length==0||queryTokens.Count==0)return false;
        return lead.All(word=>queryTokens.Any(token=>TokenMatches(word,token)))
            ||TokenMatches(lead[^1],queryTokens[^1]);
    }

    /// <summary>
    /// A short query that names no brand ("banana", "white rice") wants the plain food first; a
    /// query containing a brand from the results ("dole banana") wants that product first. A word
    /// a plain food's name also uses is the food, not a brand: "rice" stays a food query although
    /// "Akita Rice" is a brand. Lists with only one kind of result keep their order.
    /// </summary>
    private static Func<FoodResult,int> KindPreference(IReadOnlyList<FoodResult> results,IReadOnlyList<string> queryTokens)
    {
        if(!results.Any(result=>result.IsGeneric)||results.All(result=>result.IsGeneric))return _=>0;
        var brandTokens=results.Where(result=>!result.IsGeneric)
            .Select(result=>result.Name.Split(" · ",2,StringSplitOptions.None))
            .Where(parts=>parts.Length==2)
            .SelectMany(parts=>SearchTokens(parts[1]))
            .ToHashSet(StringComparer.Ordinal);
        var foodTokens=results.Where(result=>result.IsGeneric).SelectMany(result=>SearchTokens(result.Name)).ToArray();
        bool NamesBrand(string token)=>brandTokens.Contains(token)&&!foodTokens.Any(word=>TokenMatches(word,token));
        if(queryTokens.Any(NamesBrand))return result=>result.IsGeneric?1:0;
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
    /// Diary entries record no product code, so every result is matched by its normalized source and
    /// name. A provider-wide key would give every barcoded product the same count and remove the
    /// tie-break between them.
    /// </summary>
    public static string UsageKey(FoodResult result)=>NameUsageKey(result.Source,result.Name);

    /// <summary>
    /// Lower is better: 0 exact, 1 prefix, 2 contains, 3 all tokens, 4+ partial, 100 none. Exact,
    /// prefix and contains read the product name alone; token matching also reads the brand.
    /// </summary>
    public static int SearchNameRank(string name,string query)
        =>SearchNameRank(name,NormalizeSearchText(query),SearchTokens(query));

    /// <summary>True when every query word appears in the name or its brand (rank 3 or better).</summary>
    public static bool NamesEveryWord(string name,string query)=>SearchNameRank(name,query)<=AllTokensRank;

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
        // The brand after " · " counts here, so "sunglo" finds "Full Cream Greek Yoghurt · Sunglo"
        // behind every row whose own name matches, instead of leaving it among unrelated results.
        var candidateTokens=SearchTokens(name);
        var matched=queryTokens.Count(token=>candidateTokens.Any(candidateToken=>TokenMatches(candidateToken,token)));
        return matched==queryTokens.Count?3:matched>0?4+(queryTokens.Count-matched):NoMatch;
    }

    /// <summary>
    /// Plural forms match ("eggs" finds "Egg"), and a query word of three or more letters matches
    /// the start of a word, because search runs while the last word is still being typed.
    /// </summary>
    private static bool TokenMatches(string candidate,string query)
        =>string.Equals(candidate,query,StringComparison.Ordinal)
            ||string.Equals(Stem(candidate),Stem(query),StringComparison.Ordinal)
            ||query.Length>=3&&candidate.StartsWith(query,StringComparison.Ordinal);

    private static int Frequency(FoodResult result,IReadOnlyDictionary<string,int>? frequencies)
        =>frequencies is not null&&frequencies.TryGetValue(UsageKey(result),out var count)?count:0;

    private static string NameUsageKey(string source,string name)
        =>"name:"+source+"\u001f"+NormalizeSearchText(name);

    private static async Task<IReadOnlyDictionary<string,int>> UsageCounts(IReadOnlyList<FoodResult> results,AppDb db,CancellationToken ct)
    {
        var sources=results.Select(result=>result.Source).Distinct(StringComparer.Ordinal).ToArray();
        if(sources.Length==0)return new Dictionary<string,int>(StringComparer.Ordinal);

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
            var key=UsageKey(result);
            resultCounts[key]=nameCounts.GetValueOrDefault(key);
        }
        return resultCounts;
    }
}

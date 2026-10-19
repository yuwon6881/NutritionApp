namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Builds Search-a-licious queries. Its relevance favours heavily scanned products, so a brand with
/// hundreds of entries ("lactel greek" answered with Lactel milks) can push the product the person
/// named out of the first page. When no hit carries every typed word, one follow-up restricted to
/// the brand the query names asks for the remaining words inside that brand only.
/// </summary>
public static class OpenFoodFactsQuery
{
    /// <summary>
    /// The brand-scoped follow-up for <paramref name="query"/>, or null when the first page already
    /// holds a hit naming every word, the query is a single word, or no word is a brand on the page.
    /// Tokens are normalised to letters and digits, so nothing typed can alter the query syntax.
    /// </summary>
    public static string? BrandFollowUp(string query,IReadOnlyList<FoodResult> hits,IEnumerable<string?> brands)
    {
        var tokens=FoodRanking.SearchTokens(query);
        if(tokens.Length<2||hits.Any(hit=>FoodRanking.NamesEveryWord(hit.Name,query)))return null;
        var brandTokens=brands.OfType<string>().SelectMany(FoodRanking.SearchTokens).ToHashSet(StringComparer.Ordinal);
        var brand=tokens.FirstOrDefault(brandTokens.Contains);
        if(brand is null)return null;
        var rest=tokens.Where(token=>token!=brand).ToArray();
        return rest.Length==0?null:$"brands:\"{brand}\" AND "+string.Join(" AND ",rest);
    }
}

namespace Nutrition.Api.Domain;

/// <summary>
/// A food's nutrients are per 100 of one measure: grams for solids, millilitres for the liquids whose
/// providers publish per-100 ml values. No density is ever applied to convert between the two.
/// </summary>
public static class Measures
{
    public const string Grams = "g";
    public const string Millilitres = "ml";

    public static bool IsValid(string? measure) => measure is Grams or Millilitres;

    /// <summary>Maps a provider's unit text ("g", "ml", "mlt", "grm") to a measure, or null when it is neither.</summary>
    public static string? FromProviderUnit(string? unit) => unit?.Trim().ToLowerInvariant() switch
    {
        "g" or "grm" or "gm" => Grams,
        "ml" or "mlt" or "milliliter" or "millilitre" => Millilitres,
        _ => null,
    };
}

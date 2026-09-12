using System.Text.Json;
using Nutrition.Api.Data;

namespace Nutrition.Api.Domain;

public sealed class DomainException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}
public static class Validation
{
    public static void Require(bool condition, string message, int status = 400)
    { if (!condition) throw new DomainException(message, status); }
    public static void Number(double number, double min, double max, string name) => Require(double.IsFinite(number) && number >= min && number <= max, $"{name} must be between {min} and {max}.");
    public static void Units(string weight, string energy, string height)
    {
        Require(weight is "kg" or "lb", "Choose kilograms or pounds.");
        Require(energy is "kcal" or "kj", "Choose kilocalories or kilojoules.");
        Require(height is "cm" or "ft-in", "Choose centimetres or feet and inches.");
    }
    public static void Nutrients(NutrientRecord n)
    {
        Require(!string.IsNullOrWhiteSpace(n.Name) && n.Name.Length <= 160, "Food name is required (maximum 160 characters).");
        Number(n.Calories, 0, 20000, "Calories");
        foreach (var value in new[] { n.Protein, n.Fat, n.Carbs, n.Fiber }) if (value is {} v) Number(v, 0, 3000, "Nutrients");
        Require(n.Source.Length <= 240, "Source is too long.");
    }

    public static void EntryPortion(DiaryEntry entry)
    {
        var hasLabel = entry.PortionLabel is not null;
        var hasGrams = entry.PortionGrams is not null;
        Require(hasLabel == hasGrams, "Portion label and weight must be supplied together.");
        if (!hasLabel) return;

        Require(entry.Unit == "serving", "Portion details are only valid for serving entries.");
        Require(entry.PortionLabel!.Trim().Length is > 0 and <= 24, "Portion label must be 1–24 characters.");
        Number(entry.PortionGrams!.Value, .1, 10000, "Portion weight");
        Number(entry.Quantity * entry.PortionGrams.Value, .001, 100000, "Portion total");
    }

    public static void Portions(string json)
    {
        Require(json.Length <= 1200, "Portions are too large.");
        JsonDocument document;
        try { document = JsonDocument.Parse(json); }
        catch (JsonException) { throw new DomainException("Portions must be valid JSON."); }

        using (document)
        {
            Require(document.RootElement.ValueKind == JsonValueKind.Array, "Portions must be a list.");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var count = 0;
            foreach (var item in document.RootElement.EnumerateArray())
            {
                count++;
                Require(count <= 12, "A food can have at most 12 portions.");
                JsonElement label = default;
                var labelValid = item.ValueKind == JsonValueKind.Object && item.TryGetProperty("label", out label) && label.ValueKind == JsonValueKind.String;
                Require(labelValid,
                    "Each portion needs a label.");
                double weight = 0;
                var weightValid = item.ValueKind == JsonValueKind.Object && item.TryGetProperty("grams", out var grams) && grams.TryGetDouble(out weight);
                Require(weightValid,
                    "Each portion needs a gram weight.");
                var normalized = label.GetString()!.Trim();
                Require(normalized.Length is > 0 and <= 24, "Portion label must be 1–24 characters.");
                Require(seen.Add(normalized), "Portion labels must be unique.");
                Number(weight, .1, 10000, "Portion weight");
            }
        }
    }
    public static void Profile(Profile p)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);
        if (p.DateOfBirth is {} birth)
        {
            Require(birth >= new DateOnly(1900, 1, 1) && birth <= today, "Choose a valid date of birth.");
            Number(Coach.AgeAt(p, today), 1, 120, "Age");
        }
        else Number(p.Age, 1, 120, "Age");
        Number(p.HeightCm, 80, 250, "Height"); Number(p.WeightKg, 20, 400, "Weight");
        Number(p.Activity, 1.2, 2.5, "Activity");
        Require(p.Sex is "male" or "female", "Choose the equation parameter.");
        Require(p.Sex != "male" || !p.PregnancyOrBreastfeeding, "Pregnancy or breastfeeding must be cleared for the male equation parameter.");
        Require(p.Goal is "lose" or "maintain" or "gain", "Unknown goal.");
        Require(p.PhaseMode is "open" or "duration" or "weight", "Choose a goal tracking mode.");
        if (p.GoalRatePercent is {} rate)
        {
            if (p.Goal == "lose") Number(rate, -1.5, -.1, "Bodyweight loss rate");
            else if (p.Goal == "gain") Number(rate, .05, .5, "Bodyweight gain rate");
            else Require(Math.Abs(rate) <= .0001, "Maintenance uses a 0% bodyweight rate.");
        }
        if(p.EnergyAdjustmentPercent is {} adjustment) Number(adjustment,p.Goal=="maintain"?0:2,p.Goal=="lose"?25:p.Goal=="gain"?20:0,"Energy adjustment percent");
        if (p.DistributionShares is {} distribution)
        {
            Require(distribution.Count == 7, "A weekly distribution needs seven daily shares.");
            Require(distribution.All(value => double.IsFinite(value) && value >= 0), "Daily calorie shares cannot be negative.");
            Require(Math.Abs(distribution.Sum() - 100) <= .01, "Daily calorie shares must total 100%.");
        }
        if(p.PhaseStartWeightKg is {} startWeight) Number(startWeight,20,400,"Phase starting weight");
        if(p.PhaseMode=="duration")
        {
            Require(p.PhaseStart is {} start&&start>=new DateOnly(2000,1,1)&&start<=DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1),"Choose a valid phase start date.");
            Require(p.DurationWeeks is >=1 and <=104,"Choose 1–104 weeks.");
        }
        if(p.PhaseMode=="weight")
        {
            Require(p.Goal!="maintain"&&p.TargetWeightKg!=null,"Choose a target weight for fat loss or bulking.");
            Number(p.TargetWeightKg!.Value,20,400,"Target weight");
            var initial=p.PhaseStartWeightKg??p.WeightKg;
            Require(p.Goal=="lose"?p.TargetWeightKg<initial:p.TargetWeightKg>initial,"Target weight must match your phase direction from its starting weight.");
            Require(p.Goal!="lose"||p.TargetWeightKg/Math.Pow(p.HeightCm/100,2)>=18.5,"Automated fat-loss goals cannot target an underweight BMI.");
        }
        if (p.Maintenance is {} maintenance) Number(maintenance, 1000, 7000, "Maintenance estimate");
        if (p.ProteinGrams is {} protein) Number(protein, 0, 800, "Protein override");
        MacroSplit(p);
        try { TimeZoneInfo.FindSystemTimeZoneById(p.TimeZone); } catch { throw new DomainException("Unknown time zone."); }
    }
    private static void MacroSplit(Profile p)
    {
        double?[] shares = [p.ProteinPercent, p.CarbsPercent, p.FatPercent];
        if (shares.All(s => s == null)) return;
        Require(shares.All(s => s != null), "A macro split needs protein, carbohydrate, and fat shares.");
        Number(p.ProteinPercent!.Value, 10, 60, "Protein share");
        Number(p.CarbsPercent!.Value, 0, 75, "Carbohydrate share");
        Number(p.FatPercent!.Value, 15, 80, "Fat share");
        Require(Math.Abs(shares.Sum(s => s!.Value) - 100) <= 0.51, "Macro shares must total 100%.");
        Require(p.MacroPreset == null || p.MacroPreset.Length <= 40, "Unknown macro preset.");
    }
}

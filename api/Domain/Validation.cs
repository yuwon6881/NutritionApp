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
    public static void Nutrients(NutrientRecord n)
    {
        Require(!string.IsNullOrWhiteSpace(n.Name) && n.Name.Length <= 160, "Food name is required (maximum 160 characters).");
        Number(n.Calories, 0, 20000, "Calories");
        foreach (var value in new[] { n.Protein, n.Fat, n.Carbs, n.Fiber }) if (value is {} v) Number(v, 0, 3000, "Nutrients");
        Require(n.Source.Length <= 240, "Source is too long.");
    }
    public static void Profile(Profile p)
    {
        Number(p.Age, 1, 120, "Age"); Number(p.HeightCm, 80, 250, "Height"); Number(p.WeightKg, 20, 400, "Weight");
        Number(p.Activity, 1.2, 2.5, "Activity");
        Require(p.Sex is "male" or "female", "Choose the equation parameter.");
        Require(p.Goal is "lose" or "maintain" or "gain", "Unknown goal.");
        Require(p.PhaseMode is "open" or "duration" or "weight", "Choose a goal tracking mode.");
        if(p.EnergyAdjustmentPercent is {} adjustment) Number(adjustment,p.Goal=="maintain"?0:2,p.Goal=="lose"?25:p.Goal=="gain"?20:0,"Energy adjustment percent");
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
        try { TimeZoneInfo.FindSystemTimeZoneById(p.TimeZone); } catch { throw new DomainException("Unknown time zone."); }
    }
}

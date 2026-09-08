using Nutrition.Api.Domain;
using Xunit;

namespace Nutrition.Tests;

public class CoachingTests
{
    private static readonly DateOnly Today = new(2026, 9, 7);
    private static Profile Profile(string goal = "maintain") => new() { Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4, Goal = goal, Maintenance = 2500 };
    private static List<NutritionDay> Days(int count = 28, double calories = 2500) => Enumerable.Range(1, count).Select(i => new NutritionDay(Today.AddDays(-i), "complete", calories)).OrderBy(d => d.Date).ToList();
    private static List<WeightPoint> Weights(double dailyChange = 0) => Enumerable.Range(1, 28).Select(i => new WeightPoint(Today.AddDays(-i), 80 - i * dailyChange)).OrderBy(w => w.Date).ToList();

    [Fact] public void Initial_targets_follow_goal_and_floor()
    {
        Assert.Equal(2500, Coach.Calculate(Profile(), [], [], null, Today).Calories);
        Assert.InRange(Coach.Calculate(Profile("lose"), [], [], null, Today).Calories!.Value, 2000, 2499);
        Assert.InRange(Coach.Calculate(Profile("gain"), [], [], null, Today).Calories!.Value, 2501, 2750);
        var p = Profile("lose") with { Maintenance = 1600 };
        Assert.Equal(1500, Coach.Calculate(p, [], [], null, Today).Calories);
    }
    [Fact] public void Mifflin_equation_matches_reference_example() => Assert.Equal(1748.75, Coach.Resting(Profile()));
    [Fact] public void Starting_profile_requires_explicit_basic_information()
    {
        Assert.Throws<DomainException>(()=>Validation.Profile(new Profile()));
        var result=Coach.Calculate(Profile() with {Maintenance=null},[],[],null,Today);
        Assert.Contains("resting energy",result.Explanation);
        Assert.Equal(2450,result.Calories);
    }
    [Fact] public void Stable_weight_and_intake_hold_maintenance()
    {
        var result = Coach.Calculate(Profile(), Days(), Weights(), new PreviousPlan(2500, 2500), Today);
        Assert.True(result.Adaptive); Assert.Equal(2500, result.Calories); Assert.Equal(2500, result.Expenditure);
    }
    [Fact] public void Losing_weight_at_same_intake_increases_estimated_expenditure()
    {
        var r = Coach.Calculate(Profile(), Days(), Weights(-0.1), new PreviousPlan(2500, 2500), Today);
        Assert.True(r.Expenditure > 2500); Assert.Equal(2600, r.Calories);
    }
    [Fact] public void Gaining_weight_decreases_estimated_expenditure()
    {
        var r = Coach.Calculate(Profile(), Days(), Weights(0.1), new PreviousPlan(2500, 2500), Today);
        Assert.True(r.Expenditure < 2500); Assert.Equal(2400, r.Calories);
    }
    [Fact] public void Partial_day_breaks_window_and_does_not_become_zero()
    {
        var days = Days().Select(d => d.Date == Today.AddDays(-7) ? d with { Status = "incomplete", Calories = 200 } : d).ToList();
        var r = Coach.Calculate(Profile(), days, Weights(), new PreviousPlan(2400, 2400), Today);
        Assert.False(r.Adaptive); Assert.Equal(2400, r.Expenditure); Assert.Equal(2400, r.Calories);
    }
    [Fact] public void Sparse_or_stale_weights_hold()
    {
        Assert.False(Coach.Calculate(Profile(), Days(), Weights().Take(5).ToList(), new(2500, 2500), Today).Adaptive);
        Assert.False(Coach.Calculate(Profile(), Days(), Weights().Where(w => w.Date < Today.AddDays(-3)).ToList(), new(2500, 2500), Today).Adaptive);
    }
    [Fact] public void One_water_spike_does_not_change_robust_slope()
    {
        var weights = Weights().Select((w, i) => i == 15 ? w with { Kg = 84 } : w).ToList();
        Assert.Equal(0, Coach.Slope(weights));
        Assert.Equal(2500, Coach.Calculate(Profile(), Days(), weights, new(2500,2500), Today).Calories);
    }
    [Fact] public void Smoothing_uses_elapsed_calendar_time()
    {
        var trend = Coach.Trend([new(Today.AddDays(-7), 80), new(Today, 82)]);
        Assert.Equal(81, trend.Last().Kg, 5);
    }
    [Theory] [InlineData(17, false, false)] [InlineData(30, true, false)] [InlineData(30, false, true)]
    public void Unsupported_populations_have_no_automated_prescription(int age, bool pregnancy, bool medical)
    {
        var r = Coach.Calculate(Profile() with { Age = age, PregnancyOrBreastfeeding = pregnancy, MedicalNutrition = medical }, [], [], null, Today);
        Assert.False(r.Eligible); Assert.Null(r.Calories);
    }
    [Fact] public void Underweight_loss_is_blocked() => Assert.False(Coach.Calculate(Profile("lose") with { WeightKg = 45 }, [], [], null, Today).Eligible);
    [Fact] public void Incompatible_protein_is_flagged() => Assert.False(Coach.Calculate(Profile() with { ProteinGrams = 800 }, [], [], null, Today).Eligible);
    [Fact] public void Fasting_is_explicit_and_counts_as_complete()
    {
        var days = Days().Select(d => d.Date == Today.AddDays(-10) ? d with { Status = "fasting", Calories = 0 } : d).ToList();
        Assert.True(Coach.Calculate(Profile(), days, Weights(), new(2500,2500), Today).Adaptive);
    }
}

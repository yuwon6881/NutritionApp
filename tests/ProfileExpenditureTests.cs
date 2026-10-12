using Nutrition.Api.Domain;
using Xunit;

namespace Nutrition.Tests;

public sealed class ProfileExpenditureTests
{
    private static readonly Profile Base = new()
    {
        Age = 25, HeightCm = 173, WeightKg = 66, Sex = "male", Activity = 1.375, Goal = "maintain"
    };

    [Fact]
    public void Body_corrections_discard_the_old_seed()
    {
        foreach (var after in new[]
        {
            Base with { HeightCm = 180 }, Base with { WeightKg = 70 },
            Base with { Age = 28 }, Base with { DateOfBirth = new DateOnly(2001, 1, 1) },
            Base with { Sex = "female" }, Base with { Maintenance = 2400 }
        })
            Assert.Null(GoalPolicy.CarryExpenditure(Base, after, 2500));
    }

    [Fact]
    public void Goal_edits_carry_and_explicit_activity_edits_scale_the_seed()
    {
        Assert.Equal(2500, GoalPolicy.CarryExpenditure(Base, Base with { Goal = "gain" }, 2500));
        Assert.Equal(3000, GoalPolicy.CarryExpenditure(Base, Base with { Activity = 1.65 }, 2500));
        var dated = Base with { DateOfBirth = new DateOnly(2001, 1, 1) };
        Assert.Equal(2500, GoalPolicy.CarryExpenditure(dated, dated with { Age = 26 }, 2500));
    }

    [Fact]
    public void Diary_trend_still_overrides_starting_weight_after_a_correction()
    {
        var today = new DateOnly(2026, 10, 12);
        var result = Coach.Calculate(Base with { WeightKg = 80 }, [], [new(today, 66)], null, today);
        Assert.Equal(2229.21875, result.Expenditure);
    }

    [Fact]
    public void Updating_default_multipliers_does_not_reprice_an_unchanged_activity_choice()
    {
        var before = Base with { ActivityLevel = ActivityLevels.Lifting, Activity = 1.5 };
        var after = ActivityLevels.Apply(before with { Goal = "gain" });
        Assert.Equal(2700, GoalPolicy.CarryExpenditure(before, after, 2700));
        var cardio = ActivityLevels.Apply(after with { ActivityLevel = ActivityLevels.Cardio });
        Assert.Equal(2700 * 1.5 / 1.375, GoalPolicy.CarryExpenditure(before, cardio, 2700));
    }
}

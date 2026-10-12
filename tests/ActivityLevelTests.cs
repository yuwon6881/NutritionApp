using Nutrition.Api.Domain;
using Xunit;

namespace Nutrition.Tests;

public sealed class ActivityLevelTests
{
    private static readonly Profile Base = new()
    {
        Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4, Goal = "lose", TimeZone = "UTC"
    };

    [Theory]
    [InlineData(ActivityLevels.None, 1.2, false)]
    [InlineData(ActivityLevels.Lifting, 1.375, true)]
    [InlineData(ActivityLevels.Cardio, 1.5, false)]
    [InlineData(ActivityLevels.CardioAndLifting, 1.65, true)]
    public void Each_level_sets_the_multiplier_and_lifting_protein(string level, double multiplier, bool lifts)
    {
        var applied = ActivityLevels.Apply(Base with { ActivityLevel = level, Activity = 2.0, ResistanceTraining = !lifts });

        Assert.Equal(multiplier, applied.Activity);
        Assert.Equal(lifts, applied.ResistanceTraining);
    }

    [Fact]
    public void A_profile_without_a_level_keeps_its_saved_multiplier()
        => Assert.Equal(1.4, ActivityLevels.Apply(Base).Activity);

    [Fact]
    public void Lifting_starts_from_a_conservative_estimate_for_the_example_profile()
    {
        var profile = ActivityLevels.Apply(Base with
        {
            Age = 25, HeightCm = 173, WeightKg = 66, Goal = "maintain",
            ActivityLevel = ActivityLevels.Lifting
        });
        var result = Coach.Calculate(profile, [], [], null, new DateOnly(2026, 10, 12));
        Assert.Equal(1621.25, Coach.Resting(profile));
        Assert.Equal(2229.21875, result.Expenditure);
        Assert.Equal(2225, result.Calories);
    }

    [Fact]
    public void An_unknown_level_is_rejected()
        => Assert.Throws<DomainException>(() => Validation.Profile(Base with { ActivityLevel = "swimming" }));

    [Fact]
    public void Calories_and_protein_follow_the_chosen_level()
    {
        var today = new DateOnly(2026, 9, 30);
        var relaxed = Coach.Calculate(ActivityLevels.Apply(Base with { ActivityLevel = ActivityLevels.None }), [], [], null, today);
        var both = Coach.Calculate(ActivityLevels.Apply(Base with { ActivityLevel = ActivityLevels.CardioAndLifting }), [], [], null, today);

        Assert.True(both.Expenditure > relaxed.Expenditure);
        Assert.True(both.Calories > relaxed.Calories);
        Assert.Equal(160, both.Protein);
        Assert.Equal(128, relaxed.Protein);
        Assert.Contains("Cardio & lifting", both.Explanation);
    }
}

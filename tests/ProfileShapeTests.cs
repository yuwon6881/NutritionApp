using Nutrition.Api.Domain;
using Xunit;

namespace Nutrition.Tests;

public class ProfileShapeTests
{
    private static readonly DateOnly Today = new(2026, 9, 9);
    private static Profile Profile() => new() { Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4, Goal = "maintain", Maintenance = 2500 };

    [Fact] public void Age_follows_the_calendar_when_a_birth_date_is_stored()
    {
        var p = Profile() with { Age = 0, DateOfBirth = new DateOnly(1996, 9, 10) };
        Assert.Equal(29, Coach.AgeAt(p, Today));
        Assert.Equal(30, Coach.AgeAt(p, Today.AddDays(1)));
        Assert.Equal(30, Coach.AgeAt(p, new DateOnly(2027, 9, 9)));
    }
    [Fact] public void Stored_age_remains_the_fallback_without_a_birth_date() =>
        Assert.Equal(30, Coach.AgeAt(Profile(), Today));

    [Fact] public void Resting_energy_uses_the_age_derived_from_the_birth_date()
    {
        var younger = Profile() with { Age = 0, DateOfBirth = new DateOnly(1996, 1, 1) };
        var older = Profile() with { Age = 0, DateOfBirth = new DateOnly(1986, 1, 1) };
        var difference = Coach.Calculate(younger, [], [], null, Today).Expenditure!.Value
            - Coach.Calculate(older, [], [], null, Today).Expenditure!.Value;
        // Maintenance is supplied here, so only the reported resting figure changes.
        Assert.Equal(0, difference);
        Assert.Equal(50, Coach.Resting(younger with { Age = Coach.AgeAt(younger, Today) })
            - Coach.Resting(older with { Age = Coach.AgeAt(older, Today) }));
    }
    [Fact] public void A_birth_date_that_makes_the_profile_a_minor_holds_automated_targets()
    {
        var minor = Profile() with { Age = 0, DateOfBirth = Today.AddYears(-15) };
        Assert.False(Coach.Calculate(minor, [], [], null, Today).Eligible);
    }
    [Fact] public void A_stored_macro_split_replaces_the_coach_default()
    {
        var keto = Profile() with { ProteinPercent = 25, CarbsPercent = 5, FatPercent = 70 };
        var result = Coach.Calculate(keto, [], [], null, Today);
        Assert.Equal(2500, result.Calories);
        Assert.Equal(156, result.Protein);
        Assert.Equal(31.2, result.Carbs);
        Assert.Equal(194.4, result.Fat);
    }
    [Fact] public void The_coach_default_still_applies_without_a_split()
    {
        var result = Coach.Calculate(Profile(), [], [], null, Today);
        Assert.Equal(128, result.Protein);
    }
    [Fact] public void A_macro_split_must_be_complete_and_total_one_hundred()
    {
        Validation.Profile(Profile() with { ProteinPercent = 30, CarbsPercent = 40, FatPercent = 30 });
        Assert.Throws<DomainException>(() => Validation.Profile(Profile() with { ProteinPercent = 30 }));
        Assert.Throws<DomainException>(() => Validation.Profile(Profile() with { ProteinPercent = 30, CarbsPercent = 40, FatPercent = 40 }));
        Assert.Throws<DomainException>(() => Validation.Profile(Profile() with { ProteinPercent = 5, CarbsPercent = 15, FatPercent = 80 }));
    }
    [Fact] public void A_birth_date_is_validated_instead_of_the_stored_age()
    {
        Validation.Profile(Profile() with { Age = 0, DateOfBirth = new DateOnly(1996, 1, 1) });
        Assert.Throws<DomainException>(() => Validation.Profile(Profile() with { Age = 0, DateOfBirth = new DateOnly(1800, 1, 1) }));
        Assert.Throws<DomainException>(() => Validation.Profile(Profile() with { Age = 0, DateOfBirth = DateOnly.FromDateTime(DateTime.UtcNow).AddYears(2) }));
    }
}

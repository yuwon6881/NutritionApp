namespace Nutrition.Api.Domain;

/// The four activity choices the coach offers. Each sets the Mifflin–St Jeor activity multiplier
/// and whether the lifting protein target applies. A profile saved before the choice existed keeps
/// its own multiplier until it is saved again. Mirrored by web/src/lib/activityLevels.ts.
public static class ActivityLevels
{
    // Conservative starting assumptions for mostly sedentary days. Exercise type alone
    // cannot measure daily expenditure; complete intake and weigh-ins calibrate the seed.
    public const string None = "none";
    public const string Lifting = "lifting";
    public const string Cardio = "cardio";
    public const string CardioAndLifting = "cardio_lifting";

    public static readonly IReadOnlyList<string> All = [None, Lifting, Cardio, CardioAndLifting];

    public static double Multiplier(string level) => level switch
    {
        Lifting => 1.375,
        Cardio => 1.5,
        CardioAndLifting => 1.65,
        _ => 1.2
    };

    public static bool Lifts(string level) => level is Lifting or CardioAndLifting;

    public static string Label(string level) => level switch
    {
        Lifting => "Lifting",
        Cardio => "Cardio",
        CardioAndLifting => "Cardio & lifting",
        _ => "None or relaxed activity"
    };

    /// The choice is the source of truth; the multiplier and protein flag follow it.
    public static Profile Apply(Profile profile)
        => profile.ActivityLevel is { } level && All.Contains(level)
            ? profile with { Activity = Multiplier(level), ResistanceTraining = Lifts(level) }
            : profile;
}

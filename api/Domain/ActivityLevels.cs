namespace Nutrition.Api.Domain;

/// The four activity choices the coach offers. Each sets the Mifflin–St Jeor activity multiplier
/// and whether the lifting protein target applies. A profile saved before the choice existed keeps
/// its own multiplier until it is saved again. Mirrored by web/src/lib/activityLevels.ts.
public static class ActivityLevels
{
    public const string None = "none";
    public const string Lifting = "lifting";
    public const string Cardio = "cardio";
    public const string CardioAndLifting = "cardio_lifting";

    public static readonly IReadOnlyList<string> All = [None, Lifting, Cardio, CardioAndLifting];

    public static double Multiplier(string level) => level switch
    {
        Lifting => 1.5,
        Cardio => 1.6,
        CardioAndLifting => 1.75,
        _ => 1.3
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

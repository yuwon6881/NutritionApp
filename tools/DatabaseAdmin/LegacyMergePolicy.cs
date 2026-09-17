public static class LegacyMergePolicy
{
    public static IReadOnlySet<string> DurableTables { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "Days", "Entries", "Foods", "Weights", "Plans", "CheckIns", "PhaseDecisions",
        "BodyRecords", "GoogleHealthConnections", "IntegrationGrants"
    };

    public static IReadOnlySet<string> SkippedTables { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        // These rows are volatile, derived, or refer to external storage and must not be
        // copied by a database-only migration.
        "Sessions", "Receipts", "Scans", "Usage", "GoogleHealthOAuthStates",
        "DailyExpenditureEstimates", "WorkoutSummaries", "Photos"
    };

    public static IReadOnlySet<string> CredentialColumns { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "Username", "PasswordHash", "Slot", "IdentitySubject", "DisplayName"
    };
}

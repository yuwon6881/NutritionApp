namespace Nutrition.Api.Data;

public class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string DisplayName { get; set; } = "";
    public long Revision { get; set; }
    public long ProfileRevision { get; set; }
    public long CoachingSettingsRevision { get; set; }
    public long TrajectoryRevision { get; set; }
    public int CheckInWeekday { get; set; } = 1;
    public DateOnly? CoachingSettingsChangedDate { get; set; }
    public string WeightUnit { get; set; } = "kg";
    public string EnergyUnit { get; set; } = "kcal";
    public string HeightUnit { get; set; } = "cm";
    public string MissingDayAction { get; set; } = "ask";
    public string WeightGoalMetric { get; set; } = "scale";
    public string ProfileJson { get; set; } = "";
    /// Central Fitness Account subject.
    public string IdentitySubject { get; set; } = "";
}
public class Session
{
    public string Hash { get; set; } = "";
    public Guid UserId { get; set; }
    public DateTime Expires { get; set; }
}
public abstract class OwnedRecord
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public long Revision { get; set; }
    public bool Deleted { get; set; }
}
public abstract class NutrientRecord : OwnedRecord
{
    public string Name { get; set; } = "";
    public double Calories { get; set; }
    public double? Protein { get; set; }
    public double? Fat { get; set; }
    public double? Carbs { get; set; }
    public double? Fiber { get; set; }
    public string Source { get; set; } = "manual";
}
public class DiaryEntry : NutrientRecord
{
    public DateOnly Date { get; set; }
    public string? Time { get; set; }
    public double Quantity { get; set; } = 1;
    public string Unit { get; set; } = "serving";
    public string? PortionLabel { get; set; }
    public double? PortionGrams { get; set; }
}
public class Food : NutrientRecord
{
    public double ServingGrams { get; set; } = 100;
    public bool Favourite { get; set; }
    public string? Barcode { get; set; }
    public string IngredientsJson { get; set; } = "[]";
    public string PortionsJson { get; set; } = "[]";
    public double? CookedYieldGrams { get; set; }
}
public class Weight : OwnedRecord
{
    public DateOnly Date { get; set; }
    public double Kg { get; set; }
}
public class DayStatus : OwnedRecord
{
    public DateOnly Date { get; set; }
    public string Status { get; set; } = "incomplete";
    public bool Archived { get; set; }
    public int EntryCount { get; set; }
    public double Calories { get; set; }
    public double? Protein { get; set; }
    public double? Fat { get; set; }
    public double? Carbs { get; set; }
    public double? Fiber { get; set; }
}
public class AcceptedPlan : OwnedRecord
{
    public DateOnly Date { get; set; }
    public long InputRevision { get; set; }
    public long ProfileRevision { get; set; }
    public long CoachingSettingsRevision { get; set; }
    public int CheckInWeekday { get; set; } = 1;
    public string ResultJson { get; set; } = "";
    public string ProfileJson { get; set; } = "";
}
public class CheckInDecision : OwnedRecord
{
    public DateOnly WeekStart { get; set; }
    public int CheckInWeekday { get; set; } = 1;
    public DateOnly Date { get; set; }
    public string Decision { get; set; } = "declined";
    public long InputRevision { get; set; }
    public string ResultJson { get; set; } = "";
}
public class PhaseDecision : OwnedRecord
{
    public DateOnly Date { get; set; }
    public long ProfileRevision { get; set; }
    public string ReachedBy { get; set; } = "";
    public string Decision { get; set; } = "";
}
public class MutationReceipt
{
    public DateTime Created { get; set; } = DateTime.UtcNow;
    public Guid UserId { get; set; }
    public Guid Id { get; set; }
    public string Hash { get; set; } = "";
    public long Revision { get; set; }
}
public class PhysiquePhoto : OwnedRecord
{
    public DateOnly Date { get; set; }
    public Guid SetId { get; set; }
    public string Angle { get; set; } = "front";
    public string ObjectPath { get; set; } = "";
    public int Bytes { get; set; }
    public string RequestHash { get; set; } = "";
    public string Status { get; set; } = "uploading";
    public DateTime Created { get; set; } = DateTime.UtcNow;
}
public class ScanJob : OwnedRecord
{
    public string RequestHash { get; set; } = "";
    public int ImageBytes { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
    public string Status { get; set; } = "queued";
    public string? ObjectPath { get; set; }
    public string Description { get; set; } = "";
    public string Mode { get; set; } = "description";
    public string? ResultJson { get; set; }
    public string? Error { get; set; }
    public DateTime? LeaseUntil { get; set; }
}
public class AiUsage
{
    public Guid UserId { get; set; }
    public DateOnly Date { get; set; }
    public int Requests { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
}

public class DailyExpenditureEstimate
{
    public Guid UserId { get; set; }
    public DateOnly Date { get; set; }
    public double? Expenditure { get; set; }
    public int? SuggestedCalories { get; set; }
    public double Confidence { get; set; }
    public string? HoldReason { get; set; }
    public long SourceRevision { get; set; }
    public string AlgorithmVersion { get; set; } = "";
    public double? Observed { get; set; }
    public double Gain { get; set; }
    public double? TrendWeightKg { get; set; }
    public string EffectiveGoal { get; set; } = "maintain";
    public double GoalRatePercent { get; set; }
}

public class GoogleHealthConnection
{
    public Guid UserId { get; set; }
    public string GoogleIdHash { get; set; } = "";
    public string EncryptedGoogleId { get; set; } = "";
    public string EncryptedRefreshToken { get; set; } = "";
    public string EncryptedStepHistoryJson { get; set; } = "[]";
    public DateTime ConnectedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastSyncedAt { get; set; }
    public string Status { get; set; } = "connected";
    public long Revision { get; set; }
}

public class GoogleHealthOAuthState
{
    public string State { get; set; } = "";
    public Guid UserId { get; set; }
    public string SessionHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
}

public class IntegrationGrant : OwnedRecord
{
    public string Peer { get; set; } = "";
    public string Status { get; set; } = "revoked";
    public string ScopesJson { get; set; } = "[]";
    public string EncryptedRefreshToken { get; set; } = "";
    public DateTime? GrantedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}

public class WorkoutSummaryCache : OwnedRecord
{
    public string SummaryJson { get; set; } = "[]";
    public DateTime? LastSuccessAt { get; set; }
    public DateTime? LastErrorAt { get; set; }
    public string LastError { get; set; } = "";
}

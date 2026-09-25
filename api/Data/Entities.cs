namespace Nutrition.Api.Data;

public class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string DisplayName { get; set; } = "";
    public long Revision { get; set; }
    public long ProfileRevision { get; set; }
    public long CoachingSettingsRevision { get; set; }
    public long TrajectoryRevision { get; set; }
    public long FoodRevision { get; set; }
    public long DiaryRevision { get; set; }
    public long BodyRevision { get; set; }
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

/// <summary>One browser installation's opt-in push destination.</summary>
public sealed class NutritionPushSubscription
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string DeviceId { get; set; } = "";
    public string Platform { get; set; } = "web";
    public string FcmToken { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>An explicitly configured weekly check-in reminder. Disabled until the user opts in.</summary>
public sealed class NutritionCheckInReminderPreference
{
    public Guid UserId { get; set; }
    public bool Enabled { get; set; }
    public int Weekday { get; set; } = 1;
    public TimeOnly LocalTime { get; set; } = new(19, 0);
    public string TimeZoneId { get; set; } = "Asia/Kuala_Lumpur";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Per-device idempotency claim for one local calendar day's reminder.</summary>
public sealed class NutritionPushReminderDelivery
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string DeviceId { get; set; } = "";
    public DateOnly ReminderDate { get; set; }
    public string Status { get; set; } = "sending";
    public int Attempts { get; set; }
    public string LeaseId { get; set; } = "";
    public DateTime? LeaseUntil { get; set; }
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddDays(90);
    public DateTime? SentAt { get; set; }
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
    /// Deletion time used by the sync tombstone retention window. New records leave this null;
    /// legacy rows without a timestamp are handled conservatively by maintenance.
    public DateTime? DeletedAt { get; set; }
}
/// Compact, account-independent Open Food Facts product data. It contains only the fields needed
/// for barcode and serving hydration and can be rebuilt from the provider when it expires.
public class PublicFoodProduct
{
    public string Code { get; set; } = "";
    public string ResultJson { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class Weight : OwnedRecord
{
    public DateOnly Date { get; set; }
    public double Kg { get; set; }
    public string? Context { get; set; }
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
    /// GCS object generation returned by the upload. Keeping it avoids a metadata
    /// read before deletion and prevents a retry from deleting a newer replacement.
    public string? ObjectGeneration { get; set; }
    public int Bytes { get; set; }
    public string RequestHash { get; set; } = "";
    public string Status { get; set; } = "uploading";
    /// Set when deletion is requested; retention must begin at the deletion event rather than
    /// the original photo creation date.
    public DateTime? DeletedAt { get; set; }
    public DateTime Created { get; set; } = DateTime.UtcNow;
}
/// Durable queue for noncurrent GCS generations left behind by a photo replacement. The current
/// photo row points at the new generation; this work can be retried independently without ever
/// deleting a newer replacement at the same path.
public class PhotoObjectDeletion : OwnedRecord
{
    public string ObjectPath { get; set; } = "";
    public string ObjectGeneration { get; set; } = "";
    public string Status { get; set; } = "pending";
    public int Attempts { get; set; }
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public string LastError { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
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
    public long CachedInputTokens { get; set; }
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
    public string GrantedScopesJson { get; set; } = "[]";
    public bool WeightSyncEnabled { get; set; }
    public long WeightSyncRevision { get; set; }
    public DateTime? WeightLastSuccessfulSyncAt { get; set; }
    public bool NutritionSyncEnabled { get; set; }
    public long NutritionSyncRevision { get; set; }
    public DateTime? NutritionLastSuccessfulSyncAt { get; set; }
    public bool BodyFatSyncEnabled { get; set; }
    public long BodyFatSyncRevision { get; set; }
    public DateTime? BodyFatLastSuccessfulSyncAt { get; set; }
    public long ConnectionGeneration { get; set; } = 1;
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
    public string RequestedOperationsJson { get; set; } = "[]";
    public string RequestedScopesJson { get; set; } = "[]";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
}

public class GoogleHealthWeightSyncWork : OwnedRecord
{
    public Guid WeightId { get; set; }
    public long DesiredRevision { get; set; }
    public DateOnly DesiredDate { get; set; }
    public double DesiredKg { get; set; }
    public bool DesiredDeleted { get; set; }
    public string GoogleIdHash { get; set; } = "";
    public long ConnectionGeneration { get; set; }
    public string GoogleResourceName { get; set; } = "";
    public string GoogleOperationName { get; set; } = "";
    public string ProcessingState { get; set; } = "pending";
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public DateTime? LeaseUntil { get; set; }
    public string LeaseId { get; set; } = "";
    public string LastErrorCategory { get; set; } = "";
    public string LastErrorMessage { get; set; } = "";
    public int RetryCount { get; set; }
    public DateTime? LastSuccessfulSyncAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class GoogleHealthNutritionSyncWork : OwnedRecord
{
    public Guid EntryId { get; set; }
    public long DesiredRevision { get; set; }
    public DateOnly DesiredDate { get; set; }
    public string? DesiredTime { get; set; }
    public string DesiredName { get; set; } = "";
    public double DesiredCalories { get; set; }
    public double? DesiredProtein { get; set; }
    public double? DesiredFat { get; set; }
    public double? DesiredCarbs { get; set; }
    public double? DesiredFiber { get; set; }
    public bool DesiredDeleted { get; set; }
    public string GoogleIdHash { get; set; } = "";
    public long ConnectionGeneration { get; set; }
    public string GoogleResourceName { get; set; } = "";
    public string GoogleOperationName { get; set; } = "";
    public string ProcessingState { get; set; } = "pending";
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public DateTime? LeaseUntil { get; set; }
    public string LeaseId { get; set; } = "";
    public string LastErrorCategory { get; set; } = "";
    public string LastErrorMessage { get; set; } = "";
    public int RetryCount { get; set; }
    public DateTime? LastSuccessfulSyncAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class GoogleHealthBodyFatSyncWork : OwnedRecord
{
    public Guid BodyRecordId { get; set; }
    public long DesiredRevision { get; set; }
    public DateOnly DesiredDate { get; set; }
    public double DesiredBodyFatPercent { get; set; }
    public bool DesiredDeleted { get; set; }
    public string GoogleIdHash { get; set; } = "";
    public long ConnectionGeneration { get; set; }
    public string GoogleResourceName { get; set; } = "";
    public string GoogleOperationName { get; set; } = "";
    public string ProcessingState { get; set; } = "pending";
    public DateTime NextAttemptAt { get; set; } = DateTime.UtcNow;
    public DateTime? LeaseUntil { get; set; }
    public string LeaseId { get; set; } = "";
    public string LastErrorCategory { get; set; } = "";
    public string LastErrorMessage { get; set; } = "";
    public int RetryCount { get; set; }
    public DateTime? LastSuccessfulSyncAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class IntegrationGrant : OwnedRecord
{
    public string Peer { get; set; } = "";
    public string Status { get; set; } = "revoked";
    public string ScopesJson { get; set; } = "[]";
    public Guid? CentralConnectionId { get; set; }
    public long? CentralGeneration { get; set; }
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

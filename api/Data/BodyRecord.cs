namespace Nutrition.Api.Data;

public sealed class BodyMeasurements
{
    public double? NeckCm { get; set; }
    public double? ShouldersCm { get; set; }
    public double? ChestCm { get; set; }
    public double? WaistCm { get; set; }
    public double? HipsCm { get; set; }
    public double? LeftBicepsCm { get; set; }
    public double? RightBicepsCm { get; set; }
    public double? LeftForearmCm { get; set; }
    public double? RightForearmCm { get; set; }
    public double? LeftThighCm { get; set; }
    public double? RightThighCm { get; set; }
    public double? LeftCalfCm { get; set; }
    public double? RightCalfCm { get; set; }
    public double? BodyFatPercent { get; set; }
}

public sealed record BodyWeightContext(
    double? ScaleKg = null, DateOnly? ScaleDate = null,
    double? TrendKg = null, DateOnly? TrendDate = null,
    DateTime? CapturedAt = null, string? CalculationVersion = null,
    string Provenance = "legacy-unavailable");

public sealed class BodyRecord : OwnedRecord
{
    public DateOnly Date { get; set; }
    // Allocated under the account mutation lock, independent of later edits or date corrections.
    public long CreationOrder { get; set; }
    public DateTime Created { get; set; }
    public DateTime Updated { get; set; }
    public BodyMeasurements Measurements { get; set; } = new();
    public string WeightContextJson { get; set; } = "{}";
    public string PendingPhotosJson { get; set; } = "[]";
}

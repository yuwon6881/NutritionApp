using System.Diagnostics;
using System.Diagnostics.Metrics;

namespace Nutrition.Api.Services;

/// <summary>Bounded operation names only; never attach account IDs, SQL, or provider payloads.</summary>
internal static class PerformanceMetrics
{
    private static readonly Meter Meter = new("Fitness.Nutrition.Application", "1.0");
    private static readonly Histogram<double> Duration = Meter.CreateHistogram<double>("application.operation.duration", "ms");

    public static IDisposable Measure(string operation) => new Measurement(operation);

    private sealed class Measurement(string operation) : IDisposable
    {
        private readonly long started = Stopwatch.GetTimestamp();
        public void Dispose() => Duration.Record(Stopwatch.GetElapsedTime(started).TotalMilliseconds,
            new KeyValuePair<string, object?>("operation", operation));
    }
}

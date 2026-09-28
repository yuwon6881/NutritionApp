using System.Data.Common;
using System.Diagnostics.Metrics;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Nutrition.Api.Services;

/// Records low-cardinality database work for the baseline dashboard. The interceptor deliberately
/// records command kind rather than SQL text or account identifiers so diagnostics cannot become a
/// second data store for private request content.
public sealed class DatabaseMetricsInterceptor : DbCommandInterceptor
{
    private static readonly Meter Meter = new("Fitness.Nutrition.Database", "1.0");
    private static readonly Counter<long> CommandCount = Meter.CreateCounter<long>("db.command.count");
    private static readonly Histogram<double> CommandDuration = Meter.CreateHistogram<double>("db.command.duration", "ms");
    private static readonly Histogram<double> ReaderDuration = Meter.CreateHistogram<double>("db.reader.duration", "ms");

    public override DbDataReader ReaderExecuted(DbCommand command, CommandExecutedEventData eventData, DbDataReader result)
    { Record(command, eventData.Duration, "success"); return result; }

    public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
        DbDataReader result, CancellationToken cancellationToken = default)
    { Record(command, eventData.Duration, "success"); return ValueTask.FromResult(result); }

    public override object? ScalarExecuted(DbCommand command, CommandExecutedEventData eventData, object? result)
    { Record(command, eventData.Duration, "success"); return result; }

    public override ValueTask<object?> ScalarExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
        object? result, CancellationToken cancellationToken = default)
    { Record(command, eventData.Duration, "success"); return ValueTask.FromResult(result); }

    public override int NonQueryExecuted(DbCommand command, CommandExecutedEventData eventData, int result)
    { Record(command, eventData.Duration, "success"); return result; }

    public override ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
        int result, CancellationToken cancellationToken = default)
    { Record(command, eventData.Duration, "success"); return ValueTask.FromResult(result); }

    public override void CommandFailed(DbCommand command, CommandErrorEventData eventData)
        => Record(command, eventData.Duration, "failed");

    public override Task CommandFailedAsync(DbCommand command, CommandErrorEventData eventData, CancellationToken cancellationToken = default)
    { Record(command, eventData.Duration, "failed"); return Task.CompletedTask; }

    public override void CommandCanceled(DbCommand command, CommandEndEventData eventData)
        => Record(command, eventData.Duration, "canceled");

    public override Task CommandCanceledAsync(DbCommand command, CommandEndEventData eventData, CancellationToken cancellationToken = default)
    { Record(command, eventData.Duration, "canceled"); return Task.CompletedTask; }

    public override InterceptionResult DataReaderDisposing(DbCommand command, DataReaderDisposingEventData eventData, InterceptionResult result)
    {
        // EF measures this from reader creation to disposal, separately from SQL execution.
        ReaderDuration.Record(eventData.Duration.TotalMilliseconds);
        return result;
    }

    private static void Record(DbCommand command, TimeSpan duration, string outcome)
    {
        var operation = command.CommandText.TrimStart() switch
        {
            ['S', 'E', 'L', 'E', 'C', 'T', ..] or ['s', 'e', 'l', 'e', 'c', 't', ..] => "select",
            ['I', 'N', 'S', 'E', 'R', 'T', ..] or ['i', 'n', 's', 'e', 'r', 't', ..] => "insert",
            ['U', 'P', 'D', 'A', 'T', 'E', ..] or ['u', 'p', 'd', 'a', 't', 'e', ..] => "update",
            ['D', 'E', 'L', 'E', 'T', 'E', ..] or ['d', 'e', 'l', 'e', 't', 'e', ..] => "delete",
            _ => "other"
        };
        var tags = new System.Diagnostics.TagList { { "operation", operation }, { "outcome", outcome } };
        CommandCount.Add(1, tags);
        CommandDuration.Record(duration.TotalMilliseconds, tags);
    }
}

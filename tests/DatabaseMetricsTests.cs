using System.Diagnostics.Metrics;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class DatabaseMetricsTests
{
    [Fact]
    public async Task Duration_includes_SQL_execution_instead_of_interceptor_callback_time()
    {
        var durations = new List<double>();
        var readers = new List<double>();
        using var listener = new MeterListener();
        listener.InstrumentPublished = (instrument, meter) =>
        {
            if (instrument.Meter.Name == "Fitness.Nutrition.Database" && instrument.Name is "db.command.duration" or "db.reader.duration")
                meter.EnableMeasurementEvents(instrument);
        };
        listener.SetMeasurementEventCallback<double>((instrument, value, _, _) =>
        {
            if(instrument.Name=="db.reader.duration") { lock(readers)readers.Add(value); }
            else { lock (durations) durations.Add(value); }
        });
        listener.Start();
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        connection.CreateFunction("performance_delay", () => { Thread.Sleep(30); return 1; });
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection)
            .AddInterceptors(new DatabaseMetricsInterceptor()).Options);
        await db.Database.ExecuteSqlRawAsync("SELECT performance_delay()");
        await db.Database.SqlQueryRaw<int>("SELECT performance_delay() AS Value").ToListAsync();
        lock (durations) Assert.Contains(durations, duration => duration >= 25);
        lock (readers) Assert.NotEmpty(readers);
    }
}

using System.IO.Compression;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class ExportServiceTests : IAsyncLifetime
{
    private readonly string path = Path.Combine(Path.GetTempPath(), $"nutrition-export-{Guid.NewGuid()}.db");
    private AppDb Open(Guid? user = null) => new(new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={path}").Options) { CurrentUser = user };
    private static IConfiguration Config => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Retention:MealDetailDays"] = "90" }).Build();

    public async Task InitializeAsync() { await using var db = Open(); await db.Database.EnsureCreatedAsync(); }
    public Task DisposeAsync() { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); File.Delete(path); return Task.CompletedTask; }

    [Fact]
    public async Task Json_and_csv_exports_preserve_portions_and_isolate_the_current_account()
    {
        var alice = new AppUser { Username = "alice", Slot=1,ProfileJson = Json.Write(new Profile { Age=30,HeightCm=170,WeightKg=70,Sex="female",Activity=1.4,Goal="maintain" }) };
        var bob = new AppUser { Username = "bob",Slot=2 };
        await using (var seed = Open())
        {
            seed.Users.AddRange(alice, bob);
            await seed.SaveChangesAsync();
        }
        await using (var seed = Open(alice.Id))
        {
            seed.Entries.Add(new DiaryEntry { Id=Guid.NewGuid(),UserId=alice.Id,Date=new(2026,9,10),Name="Rice",Quantity=1.5,Unit="serving",PortionLabel="bowl",PortionGrams=180,Calories=390,Source="manual" });
            seed.BodyRecords.Add(new BodyRecord { Id=Guid.NewGuid(),UserId=alice.Id,Date=new(2026,9,10),CreationOrder=1,Measurements=new BodyMeasurements { WaistCm=82 },WeightContextJson=Json.Write(new BodyWeightContext()),PendingPhotosJson="[]" });
            await seed.SaveChangesAsync();
        }
        await using (var seed = Open(bob.Id))
        {
            seed.Entries.Add(new DiaryEntry { Id=Guid.NewGuid(),UserId=bob.Id,Date=new(2026,9,10),Name="Private",Quantity=1,Unit="serving",Calories=500,Source="manual" });
            await seed.SaveChangesAsync();
        }

        await using var db = Open(alice.Id);
        var service = new ExportService(db, new RetentionService(db, Config));
        var json = await service.BuildJsonDocument(default);
        var entry = Assert.Single(json.Entries);
        Assert.Equal("Rice", entry.Name);
        Assert.Equal("bowl", entry.PortionLabel);
        Assert.Equal(180, entry.PortionGrams);
        var body=Assert.Single(json.BodyRecords);
        Assert.Equal(82,body.Measurements.WaistCm);

        await using var output = new MemoryStream();
        await service.WriteCsvBundle(output, default);
        output.Position = 0;
        using var archive = new ZipArchive(output, ZipArchiveMode.Read);
        Assert.NotNull(archive.GetEntry("README.txt"));
        var entriesCsv = await Read(archive, "entries.csv");
        Assert.Contains(",bowl,180,", entriesCsv, StringComparison.Ordinal);
        Assert.DoesNotContain("Private", entriesCsv, StringComparison.Ordinal);
        var bodyCsv=await Read(archive,"body-records.csv");
        Assert.Contains("waist_cm",bodyCsv,StringComparison.Ordinal);
        Assert.Contains("82",bodyCsv,StringComparison.Ordinal);
        var profileCsv = await Read(archive, "profile.csv");
        Assert.Contains("profile_json,\"{\"\"age\"\":30", profileCsv, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("profile_json,\"\"\"", profileCsv, StringComparison.Ordinal);
    }

    private static async Task<string> Read(ZipArchive archive, string name)
    {
        await using var stream = archive.GetEntry(name)!.Open();
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return await reader.ReadToEndAsync();
    }
}

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;

var directory=Path.GetFullPath(Path.Combine("artifacts","storage-"+Guid.NewGuid().ToString("N")));Directory.CreateDirectory(directory);
var path=Path.Combine(directory,"benchmark.db");
await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source="+path).Options);
await db.Database.EnsureCreatedAsync();
var configuration=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"Retention:MealDetailDays","7"}}).Build();
var users=new[]{new AppUser { Username="synthetic-one",Slot=1,PasswordHash="disabled" },new AppUser { Username="synthetic-two",Slot=2,PasswordHash="disabled" }};
db.Users.AddRange(users);await db.SaveChangesAsync();
// One transaction, 20 entries/day/user, ten years. All data is synthetic and disposable.
await db.Database.ExecuteSqlRawAsync("""
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<73000)
INSERT INTO "Entries" ("UserId","Id","Revision","Deleted","Name","Calories","Protein","Fat","Carbs","Fiber","Source","Date","Meal","Quantity","Unit")
SELECT u."Id",hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)),n,0,'Representative Malaysian mixed meal',450,20,15,55,3,'Personal recipe',date('now','-'||CAST((n-1)/20 AS INTEGER)||' days'),'Lunch',250,'g'
FROM seq CROSS JOIN "Users" u;
WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<3649)
INSERT INTO "Days" ("UserId","Id","Revision","Deleted","Date","Status","Archived","EntryCount","Calories","Protein","Fat","Carbs","Fiber")
SELECT u."Id",hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)),1,0,date('now','-'||n||' days'),'complete',0,0,0,NULL,NULL,NULL,NULL FROM seq CROSS JOIN "Users" u;
WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<3649)
INSERT INTO "Weights" ("UserId","Id","Revision","Deleted","Date","Kg")
SELECT u."Id",hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)),1,0,date('now','-'||n||' days'),80+(n%10)/10.0 FROM seq CROSS JOIN "Users" u;
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<73000)
INSERT INTO "Receipts" ("UserId","Id","Hash","Revision","Created")
SELECT u."Id",hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)),hex(randomblob(32)),n,datetime('now','-'||CAST((n-1)/20 AS INTEGER)||' days') FROM seq CROSS JOIN "Users" u;
""");
await db.Database.ExecuteSqlRawAsync("PRAGMA wal_checkpoint(TRUNCATE)");
var before=new FileInfo(path).Length;var beforeEntries=await db.Entries.IgnoreQueryFilters().CountAsync();
var retention=new RetentionService(db,configuration);var deleted=0;
foreach(var user in users)
{
    while(true){var count=await retention.CompactUser(user.Id,DateOnly.FromDateTime(DateTime.UtcNow),default);deleted+=count;db.ChangeTracker.Clear();if(count==0)break;}
}
var remaining=await db.Entries.IgnoreQueryFilters().CountAsync();
var summaries=await db.Days.IgnoreQueryFilters().CountAsync(d=>d.Archived);
var weights=await db.Weights.IgnoreQueryFilters().CountAsync();
await db.Database.ExecuteSqlRawAsync("PRAGMA wal_checkpoint(TRUNCATE)");var allocated=new FileInfo(path).Length;
await db.Database.ExecuteSqlRawAsync("VACUUM");await db.Database.ExecuteSqlRawAsync("PRAGMA wal_checkpoint(TRUNCATE)");var compacted=new FileInfo(path).Length;
var report=new { engine="SQLite local benchmark; PostgreSQL measurement remains required",users=2,years=10,entriesBefore=beforeEntries,entriesAfter=remaining,deletedEntries=deleted,dailySummaries=summaries,weightsRetained=weights,receiptsRetained=await db.Receipts.IgnoreQueryFilters().CountAsync(),beforeBytes=before,afterDeleteAllocatedBytes=allocated,afterVacuumBytes=compacted,reductionPercent=Math.Round(100d*(before-compacted)/before,1),notes="Includes diary, daily summaries, weights and receipts with indexes. Does not include food libraries, photos, accepted plans or PostgreSQL catalog overhead." };
var text=System.Text.Json.JsonSerializer.Serialize(report,new System.Text.Json.JsonSerializerOptions { WriteIndented=true });
await File.WriteAllTextAsync(Path.Combine(directory,"report.json"),text);Console.WriteLine(text);Console.WriteLine(directory);

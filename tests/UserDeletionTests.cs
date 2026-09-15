using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;
namespace Nutrition.Tests;
public class UserDeletionTests
{
    [Fact] public async Task Deleting_an_account_removes_every_row_it_owns()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var auth=new AuthService(db);
        var user=await TestUsers.CreateAsync(db, "alice");
        var other=await TestUsers.CreateAsync(db, "bob");
        db.CurrentUser=user.Id;
        await auth.CreateSession(user.Id,default);
        var date=new DateOnly(2026,9,7);
        db.Entries.Add(new DiaryEntry { Id=Guid.NewGuid(),UserId=user.Id,Date=date,Name="Rice",Calories=200 });
        db.Weights.Add(new Weight { Id=Guid.NewGuid(),UserId=user.Id,Date=date,Kg=80 });
        db.Days.Add(new DayStatus { Id=Guid.NewGuid(),UserId=user.Id,Date=date,Status="complete" });
        db.Plans.Add(new AcceptedPlan { Id=Guid.NewGuid(),UserId=user.Id,Date=date });
        db.CheckIns.Add(new CheckInDecision { Id=Guid.NewGuid(),UserId=user.Id,WeekStart=date,Date=date,InputRevision=1,ResultJson="{}" });
        db.PhaseDecisions.Add(new PhaseDecision { Id=Guid.NewGuid(),UserId=user.Id,Date=date,ProfileRevision=1,ReachedBy="trend",Decision="completed" });
        db.Foods.Add(new Food { Id=Guid.NewGuid(),UserId=user.Id,Name="Oats",Calories=380 });
        db.Scans.Add(new ScanJob { Id=Guid.NewGuid(),UserId=user.Id });
        db.Photos.Add(new PhysiquePhoto { Id=Guid.NewGuid(),UserId=user.Id,Date=date });
        db.Receipts.Add(new MutationReceipt { Id=Guid.NewGuid(),UserId=user.Id,Hash="hash",Revision=1 });
        db.Usage.Add(new AiUsage { UserId=user.Id,Date=date,Requests=1 });
        await db.SaveChangesAsync();
        db.CurrentUser=other.Id;
        await auth.CreateSession(other.Id,default);
        db.Receipts.Add(new MutationReceipt { Id=Guid.NewGuid(),UserId=other.Id,Hash="hash",Revision=1 });
        db.Usage.Add(new AiUsage { UserId=other.Id,Date=date,Requests=1 });
        await db.SaveChangesAsync();

        // Deleted straight in the database, so only the schema cascade can clean up behind it.
        await using(var admin=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options))
            Assert.Equal(1,await admin.Users.Where(u=>u.Id==user.Id).ExecuteDeleteAsync());
        db.ChangeTracker.Clear();

        Assert.Empty(await db.Sessions.Where(x=>x.UserId==user.Id).ToListAsync());
        Assert.Empty(await db.Receipts.IgnoreQueryFilters().Where(x=>x.UserId==user.Id).ToListAsync());
        Assert.Empty(await db.Usage.IgnoreQueryFilters().Where(x=>x.UserId==user.Id).ToListAsync());
        Assert.Empty(await db.Entries.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await db.Weights.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await db.Days.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await db.Plans.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await db.CheckIns.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await db.PhaseDecisions.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await db.Foods.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await db.Scans.IgnoreQueryFilters().ToListAsync());
        Assert.Empty(await db.Photos.IgnoreQueryFilters().ToListAsync());
        // The surviving account keeps its own rows.
        Assert.Single(await db.Sessions.Where(x=>x.UserId==other.Id).ToListAsync());
        Assert.Single(await db.Receipts.IgnoreQueryFilters().ToListAsync());
        Assert.Single(await db.Usage.IgnoreQueryFilters().ToListAsync());
    }
}

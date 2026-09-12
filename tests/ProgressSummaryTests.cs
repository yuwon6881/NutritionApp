using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class ProgressSummaryTests
{
    [Fact]
    public void Calendar_periods_include_the_end_date_and_clamp_month_subtraction()
    {
        var month=ProgressSummaryService.ResolveRange("month",new DateOnly(2026,3,31));
        var week=ProgressSummaryService.ResolveRange("week",new DateOnly(2026,3,31));
        var halfYear=ProgressSummaryService.ResolveRange("six-months",new DateOnly(2026,3,31));

        Assert.Equal(new DateOnly(2026,3,1),month.Start);
        Assert.Equal(new DateOnly(2026,3,31),month.End);
        Assert.Equal(7,week.End.DayNumber-week.Start.DayNumber+1);
        Assert.Equal(new DateOnly(2025,10,1),halfYear.Start);
        Assert.Equal("daily",ProgressSummaryService.EnergyGrouping("month",month.Start,month.End));
        Assert.Equal("weekly",ProgressSummaryService.EnergyGrouping("six-months",halfYear.Start,halfYear.End));
        Assert.Equal("monthly",ProgressSummaryService.EnergyGrouping("year",new DateOnly(2025,4,1),new DateOnly(2026,3,31)));
    }

    [Fact]
    public async Task Summary_uses_archived_totals_and_returns_bounded_weight_series()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>()).Build();
        var user=await new AuthService(db,config).Register("progress-user","a sufficiently long password",default);
        var profile=new Profile{Age=30,DateOfBirth=new DateOnly(1996,1,1),HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="maintain",Maintenance=2400,TimeZone="Asia/Kuala_Lumpur"};
        user.ProfileJson=Json.Write(profile);user.Revision=1;db.CurrentUser=user.Id;
        var current=RetentionService.Today(user.ProfileJson);
        for(var i=0;i<450;i++)db.Weights.Add(new Weight{Id=Guid.NewGuid(),UserId=user.Id,Date=current.AddDays(-449+i),Kg=80+i%9*.1});
        var archived=current.AddDays(-450);
        db.Days.Add(new DayStatus{Id=Guid.NewGuid(),UserId=user.Id,Date=archived,Archived=true,Status="complete",EntryCount=2,Calories=2300,Protein=120,Carbs=240,Fat=70});
        await db.SaveChangesAsync();
        using var cache=new MemoryCache(new MemoryCacheOptions{SizeLimit=32});
        var service=new ProgressSummaryService(db,new ExpenditureTrajectoryService(db),cache);

        var summary=await service.Get("all",default);

        Assert.Equal(archived,summary.Start);
        Assert.Equal(current,summary.End);
        Assert.Equal("monthly",summary.Grouping.Energy);
        Assert.True(summary.Weight.Series.Count<=400);
        Assert.Equal(current.AddDays(-449),summary.Weight.Series[0].Date);
        Assert.Equal(current,summary.Weight.Series[^1].Date);
        Assert.Contains(summary.Energy.Series,bucket=>bucket.Date==archived&&bucket.Intake==2300);
        Assert.Equal(10,summary.Weight.EditableWeighIns.Count);
        var week=await service.Get("week",default);
        Assert.Equal(summary.Weight.Statistics.LatestTrendKg,week.Weight.Statistics.LatestTrendKg);
        var expected=Coach.Trend((await db.Weights.OrderBy(w=>w.Date).ToListAsync()).Select(w=>new WeightPoint(w.Date,w.Kg)).ToList());
        Assert.Equal(expected[^1].Kg,week.Weight.Statistics.LatestTrendKg);
    }
}

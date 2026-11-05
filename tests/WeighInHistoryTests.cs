using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class WeighInHistoryTests
{
    [Fact]
    public async Task Pages_walk_backwards_from_the_cursor_within_the_period_and_skip_deleted_rows()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"history-user");
        var other=await TestUsers.CreateAsync(db,"other-user");
        var day=new DateOnly(2026,10,31);
        db.CurrentUser=other.Id;
        db.Weights.Add(new Weight{Id=Guid.NewGuid(),UserId=other.Id,Date=day.AddDays(-5),Kg=99});
        await db.SaveChangesAsync();
        db.CurrentUser=user.Id;
        for(var i=0;i<25;i++)db.Weights.Add(new Weight{Id=Guid.NewGuid(),UserId=user.Id,Date=day.AddDays(-i),Kg=70+i*.1,Deleted=i==3});
        await db.SaveChangesAsync();

        var first=await WeighInHistory.Page(db,day.AddDays(-19),day.AddDays(-1),8,default);
        Assert.Equal(8,first.Items.Count);
        Assert.True(first.HasMore);
        Assert.Equal(day.AddDays(-2),first.Items[0].Date);
        Assert.DoesNotContain(first.Items,item=>item.Date==day.AddDays(-3));
        Assert.DoesNotContain(first.Items,item=>item.Kg==99);
        Assert.True(first.Items.Zip(first.Items.Skip(1)).All(pair=>pair.First.Date>pair.Second.Date));

        var last=await WeighInHistory.Page(db,day.AddDays(-19),first.Items[^1].Date,9,default);
        Assert.False(last.HasMore);
        Assert.Equal(day.AddDays(-19),last.Items[^1].Date);
        // The period start bounds the page: 2..19 days back holds 18 dates, one of them deleted.
        Assert.Equal(17,first.Items.Count+last.Items.Count);
    }

    [Fact]
    public async Task Page_size_is_bounded()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"history-user");
        var day=new DateOnly(2026,10,31);
        db.CurrentUser=user.Id;
        for(var i=0;i<WeighInHistory.MaxPageSize+10;i++)db.Weights.Add(new Weight{Id=Guid.NewGuid(),UserId=user.Id,Date=day.AddDays(-i),Kg=70});
        await db.SaveChangesAsync();

        var page=await WeighInHistory.Page(db,day.AddYears(-1),day.AddDays(1),1000,default);
        Assert.Equal(WeighInHistory.MaxPageSize,page.Items.Count);
        Assert.True(page.HasMore);
    }
}

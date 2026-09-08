using Nutrition.Api.Domain;
using Xunit;
namespace Nutrition.Tests;

public class LoggingDayTests
{
    [Theory]
    [InlineData(0,"complete",true,"incomplete")]
    [InlineData(-1,"incomplete",true,"complete")]
    [InlineData(-1,null,false,"incomplete")]
    [InlineData(-1,"not_logged",true,"not_logged")]
    [InlineData(-1,"fasting",false,"fasting")]
    public void Calendar_status_preserves_missing_intake(int offset,string? status,bool food,string expected)
    {
        var today=new DateOnly(2026,9,8);
        Assert.Equal(expected,LoggingDay.Status(today.AddDays(offset),today,status,food));
    }
}

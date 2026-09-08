using Nutrition.Api.Domain;
using Xunit;
namespace Nutrition.Tests;
public sealed class GoalPhaseTests
{
    private static readonly DateOnly Today=new(2026,9,8);
    private static Profile P(string goal="lose")=>new(){Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal=goal,Maintenance=2500};
    private static NutritionDay[] Days(double calories)=>Enumerable.Range(1,28).Select(i=>new NutritionDay(Today.AddDays(-i),"complete",calories)).ToArray();
    private static WeightPoint[] Weights(double kg=80)=>Enumerable.Range(1,28).Select(i=>new WeightPoint(Today.AddDays(-i),kg)).OrderBy(w=>w.Date).ToArray();
    [Fact] public void Plateau_at_lower_intake_gradually_lowers_estimated_maintenance()
    {
        var first=Coach.Calculate(P(),Days(2000),Weights(),new(2000,2500),Today);
        var second=Coach.Calculate(P(),Days(2000),Weights(),new(first.Calories!.Value,first.Expenditure!.Value),Today);
        Assert.Equal(2375,first.Expenditure);Assert.Equal(2281.25,second.Expenditure);
        Assert.InRange(2000-first.Calories!.Value,0,100);Assert.True(second.Calories<first.Calories);
        var bulk=Coach.Calculate(P("gain"),Days(2000),Weights(),null,Today,startingExpenditure:2000);
        Assert.True(bulk.Calories>bulk.Expenditure);
    }
    [Fact] public void Duration_ends_with_reviewable_maintenance_and_completion_stays_latched()
    {
        var profile=P() with {PhaseMode="duration",PhaseStart=Today.AddDays(-28),DurationWeeks=4};
        var result=Coach.Calculate(profile,[],Weights(),new(2000,2500),Today);
        Assert.True(result.PhaseComplete);Assert.Equal("maintain",result.EffectiveGoal);Assert.Equal(2500,result.Calories);
        var weightGoal=P() with {PhaseMode="weight",TargetWeightKg=75};
        var accepted=Coach.Calculate(weightGoal,[],Weights(74),new(2000,2500),Today);
        Assert.True(accepted.PhaseComplete);
        Assert.True(Coach.Calculate(weightGoal,[],Weights(80),new(2500,2500,true),Today).PhaseComplete);
    }
    [Fact] public void One_low_scale_weight_does_not_finish_a_weight_goal()
    {
        var points=Weights();points[^1]=points[^1] with {Kg=74};
        var result=Coach.Calculate(P() with {PhaseMode="weight",TargetWeightKg=75},Days(2000),points,new(2000,2500),Today);
        Assert.False(result.PhaseComplete);
    }
    [Fact] public void Chosen_pace_is_applied_and_excessive_deficits_are_rejected()
    {
        var p=P() with {EnergyAdjustmentPercent=20};
        var result=Coach.Calculate(p,[],[],null,Today);
        Assert.Equal(2000,result.Calories);Assert.Contains("20%",result.Explanation);
        Assert.Throws<DomainException>(()=>Validation.Profile(p with {EnergyAdjustmentPercent=30}));
        Assert.Equal(2300,GoalPolicy.CarryExpenditure(P(),P("gain"),2300));
    }
    [Fact] public void Finish_date_uses_observed_pace_and_disappears_during_a_plateau()
    {
        var profile=P() with {PhaseMode="weight",TargetWeightKg=75,PhaseStartWeightKg=80};
        var points=Enumerable.Range(0,28).Select(i=>new WeightPoint(Today.AddDays(-28+i),80-i*.03)).ToArray();
        var progress=GoalPolicy.Evaluate(profile,points,Today);
        Assert.NotNull(progress.EstimatedFinish);Assert.InRange(progress.Percent!.Value,0.1,100);
        Assert.Null(GoalPolicy.Evaluate(profile,Weights(),Today).EstimatedFinish);
        Assert.Null(GoalPolicy.Evaluate(profile,points.Take(3).ToArray(),Today).EstimatedFinish);
    }
}

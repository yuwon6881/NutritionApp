using Nutrition.Api.Data;
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
    [Fact] public void Duration_reaches_a_review_point_without_completing_the_phase()
    {
        var profile=P() with {PhaseMode="duration",PhaseStart=Today.AddDays(-28),DurationWeeks=4};
        var result=Coach.Calculate(profile,[],Weights(),new(2000,2500),Today);
        Assert.False(result.PhaseComplete);Assert.Equal("lose",result.EffectiveGoal);Assert.Equal(2000,result.Calories);
        Assert.True(result.GoalProgress!.DurationReached);
        var weightGoal=P() with {PhaseMode="weight",TargetWeightKg=75};
        var accepted=Coach.Calculate(weightGoal,[],Weights(74),new(2000,2500),Today);
        Assert.False(accepted.PhaseComplete);Assert.True(accepted.GoalProgress!.TrendReached);
        var completed=Coach.Calculate(weightGoal,[],Weights(74),new(2000,2500),Today,
            phaseDecision:new PhaseDecision {Decision="completed",ReachedBy="trend"});
        Assert.True(completed.PhaseComplete);Assert.Equal("maintain",completed.EffectiveGoal);Assert.Equal(2500,completed.Calories);
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
    [Fact] public void Weight_goal_reports_its_starting_position_target_and_remaining_distance()
    {
        var profile=P() with {PhaseMode="weight",TargetWeightKg=75,PhaseStartWeightKg=80};
        var halfway=GoalPolicy.Evaluate(profile,Weights(77.5),Today);
        Assert.Equal("lose",halfway.Goal);Assert.Equal(80,halfway.StartWeight);Assert.Equal(75,halfway.TargetWeight);
        Assert.Equal(50,halfway.Percent!.Value,3);Assert.Equal(2.5,halfway.Remaining!.Value,3);Assert.False(halfway.Complete);
        var reached=GoalPolicy.Evaluate(profile,Weights(74),Today);
        Assert.False(reached.Complete);Assert.True(reached.ScaleReached);Assert.True(reached.TrendReached);
        Assert.Equal(100,reached.Percent);Assert.Equal(0,reached.Remaining);
        var completed=GoalPolicy.Evaluate(profile,Weights(74),Today,
            new PhaseDecision {Decision="completed",ReachedBy="trend"});
        Assert.True(completed.Complete);Assert.Equal(0,completed.Remaining);
        // A goal completed earlier keeps its reached state even after the weight drifts back.
        var latched=GoalPolicy.Evaluate(profile,Weights(79),Today,alreadyComplete:true);
        Assert.True(latched.Complete);Assert.Equal(0,latched.Remaining);
        var gain=GoalPolicy.Evaluate(P("gain") with {PhaseMode="weight",TargetWeightKg=85,PhaseStartWeightKg=80},Weights(82),Today);
        Assert.Equal(40,gain.Percent!.Value,3);Assert.Equal(3,gain.Remaining!.Value,3);
        var open=GoalPolicy.Evaluate(P(),Weights(),Today);
        Assert.Null(open.Percent);Assert.Null(open.TargetWeight);Assert.Null(open.Remaining);Assert.Equal(80,open.StartWeight);
    }
    [Fact] public void Weight_goal_respects_metric_setting_and_computes_optimistic_finish()
    {
        var profile=P() with {PhaseMode="weight",TargetWeightKg=75,PhaseStartWeightKg=80,GoalRatePercent=0.5};
        var plateau=Weights(78.5);
        // Latest day scale weight is 77.0
        plateau[^1]=plateau[^1] with {Kg=77.0};

        var scaleProg=GoalPolicy.Evaluate(profile,plateau,Today,weightGoalMetric:"scale");
        Assert.Equal(60,scaleProg.Percent!.Value,1);
        Assert.Equal(2.0,scaleProg.Remaining!.Value,1);

        var trendProg=GoalPolicy.Evaluate(profile,plateau,Today,weightGoalMetric:"trend");
        Assert.True(trendProg.Percent < scaleProg.Percent);
        Assert.True(trendProg.Remaining > scaleProg.Remaining);

        // OptimisticFinish is populated from planned rate even when plateau makes EstimatedFinish null
        Assert.Null(trendProg.EstimatedFinish);
        Assert.NotNull(trendProg.OptimisticFinish);

        // Empty weigh-ins still yields 0% percent and OptimisticFinish
        var emptyProg=GoalPolicy.Evaluate(profile,[],Today);
        Assert.Equal(0,emptyProg.Percent);
        Assert.Equal(5,emptyProg.Remaining);
        Assert.NotNull(emptyProg.OptimisticFinish);
    }
}

namespace Nutrition.Api.Domain;
public record GoalProgress(string Mode,double? Percent,bool Complete,DateOnly? EstimatedFinish,DateOnly? PhaseEnd,double? TrendWeight,double? WeeklyChange,string Explanation)
{
    // The configured goal survives completion, when the coach itself switches to a maintenance target.
    public string Goal { get; init; } = "maintain";
    public double? StartWeight { get; init; }
    public double? TargetWeight { get; init; }
    public double? Remaining { get; init; }
}
public static class GoalPolicy
{
    public static GoalProgress Evaluate(Profile p,IReadOnlyList<WeightPoint> weights,DateOnly today,bool alreadyComplete=false)
    {
        var points=weights.Where(w=>w.Date<=today).OrderBy(w=>w.Date).ToArray();
        var trend=Coach.Trend(points);var current=trend.LastOrDefault()?.Kg;
        var startWeight=p.PhaseStartWeightKg??p.WeightKg;
        var goalWeight=p.PhaseMode=="weight"?p.TargetWeightKg:null;
        // Remaining is measured toward the target in the goal's own direction, so an overshoot reads as nothing left.
        double? Remaining(bool complete)=>goalWeight is not {} target||current is not {} value?null
            :complete?0:Math.Max(p.Goal=="lose"?value-target:target-value,0);
        GoalProgress Progress(string mode,double? percent,bool complete,DateOnly? finish,DateOnly? end,double? weekly,string explanation)
            => new(mode,percent,complete,finish,end,current,weekly,explanation)
                { Goal=p.Goal,StartWeight=startWeight,TargetWeight=goalWeight,Remaining=Remaining(complete) };
        if(p.PhaseMode=="duration"&&p.PhaseStart is {} start&&p.DurationWeeks is {} weeks)
        {
            var end=start.AddDays(weeks*7);var percent=Math.Clamp(100d*(today.DayNumber-start.DayNumber)/(weeks*7),0,100);
            return Progress("duration",alreadyComplete?100:percent,alreadyComplete||today>=end,null,end,null,"This percentage measures time through your phase, not fat or muscle change. Pace remains your chosen deficit or surplus.");
        }
        if(p.PhaseMode!="weight"||p.TargetWeightKg is not {} target)return Progress("open",null,alreadyComplete,null,null,null,"Choose a duration or weight goal to track phase progress.");
        var initial=startWeight;
        var percentDone=current is {} value&&Math.Abs(target-initial)>.001?Math.Clamp(100*(value-initial)/(target-initial),0,100):(double?)null;
        var fresh=points.Length>=3&&points[^1].Date>=today.AddDays(-3);
        var complete=alreadyComplete||(fresh&&points[^1].Date.DayNumber-points[^3].Date.DayNumber>=2&&trend.TakeLast(3).All(w=>p.Goal=="lose"?w.Kg<=target:w.Kg>=target));
        if(complete)return Progress("weight",100,true,today,null,null,"The recent smoothed weights reached your goal. Review maintenance; this completion remains accepted until you change your phase.");
        var recent=points.Where(w=>w.Date>=today.AddDays(-28)).ToArray();
        var enough=recent.Length>=6&&recent[^1].Date.DayNumber-recent[0].Date.DayNumber>=14&&fresh;
        if(!enough)return Progress("weight",percentDone,false,null,null,null,"A finish estimate needs six weigh-ins spanning at least 14 days, including one within three days.");
        var slope=Coach.Slope(recent);var dailyRemaining=(target-current!.Value)/slope;
        if(!double.IsFinite(dailyRemaining)||dailyRemaining<=0||Math.Abs(slope)<.001)return Progress("weight",percentDone,false,null,null,slope*7,"Your observed trend is flat or moving away from this goal. No finish date can currently be estimated.");
        if(dailyRemaining>730)return Progress("weight",percentDone,false,null,null,slope*7,"At your recent pace the goal is more than two years away; a precise finish date would be misleading.");
        return Progress("weight",percentDone,false,today.AddDays((int)Math.Ceiling(dailyRemaining)),null,slope*7,"Conditional estimate from the robust rate of recent recorded weights. It changes with your data and assumes the recent pace continues; it is not a promise or a fixed calorie-per-kilogram prediction.");
    }
    public static double? CarryExpenditure(Profile before,Profile after,double? learned)
    {
        if(before.Maintenance!=after.Maintenance)return null;
        if(learned is not {} value)return null;
        return Math.Clamp(value*after.Activity/before.Activity,1000,7000);
    }
}

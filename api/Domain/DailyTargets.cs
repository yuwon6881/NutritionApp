namespace Nutrition.Api.Domain;

public static class DailyTargets
{
    public static IReadOnlyList<int> Allocate(double weeklyCalories, IReadOnlyList<double>? shares)
    {
        var budget = checked((int)Math.Round(weeklyCalories, MidpointRounding.AwayFromZero));
        var weights = shares is { Count: 7 } && shares.All(value => double.IsFinite(value) && value >= 0) && shares.Sum() > 0
            ? shares.ToArray()
            : Enumerable.Repeat(1d, 7).ToArray();
        var total = weights.Sum();
        var raw = weights.Select(weight => budget * weight / total).ToArray();
        var result = raw.Select(Math.Floor).Select(value => (int)value).ToArray();
        var remainder = budget - result.Sum();
        foreach (var index in Enumerable.Range(0, 7)
                     .OrderByDescending(index => raw[index] - result[index])
                     .ThenBy(index => index)
                     .Take(remainder))
            result[index]++;
        return result;
    }

    public static double[] Normalise(IReadOnlyList<double>? shares)
    {
        var values = shares is { Count: 7 } ? shares.ToArray() : Enumerable.Repeat(100d / 7, 7).ToArray();
        var total = values.Sum();
        return total > 0 && values.All(value => double.IsFinite(value) && value >= 0)
            ? values.Select(value => value / total * 100).ToArray()
            : Enumerable.Repeat(100d / 7, 7).ToArray();
    }
}

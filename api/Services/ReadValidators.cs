using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

internal static class ReadValidators
{
    public static string Bootstrap(AppUser user, DateOnly day, int detailDays, long grantRevision,
        long trainingRevision, bool connected, bool warning)
        => $"\"bootstrap:{ExpenditureTrajectory.AlgorithmVersion}:{user.Id:N}:{user.Revision}:{user.ProfileRevision}:{user.CoachingSettingsRevision}:{user.DiaryRevision}:{user.TrajectoryRevision}:{user.BodyRevision}:{user.FoodRevision}:{day:yyyy-MM-dd}:{detailDays}:{grantRevision}:{trainingRevision}:{connected}:{warning}\"";

    public static string Progress(AppUser user, string period, DateOnly day)
        => $"\"progress:{ExpenditureTrajectory.AlgorithmVersion}:{user.Id:N}:{period}:{day:yyyy-MM-dd}:{user.Revision}:{user.ProfileRevision}:{user.DiaryRevision}:{user.TrajectoryRevision}\"";
}

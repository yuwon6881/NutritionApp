using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

/// One view: either a saved photo of the signed-in account or a freshly prepared image.
public sealed record BodyFatEstimatePhoto(string Angle,Guid? PhotoId,string? ImageBase64);
public sealed record BodyFatEstimateInput(DateOnly Date,IReadOnlyList<BodyFatEstimatePhoto> Photos,Dictionary<string,double?>? Measurements);
public sealed record BodyFatEstimateInputs(int Photos,double? HeightCm,string? Sex,int? Age,double? ScaleKg,double? TrendKg,IReadOnlyList<string> MeasurementKeys);
public sealed record BodyFatEstimateView(double EstimatePercent,double LowPercent,double HighPercent,string Confidence,
    string Explanation,IReadOnlyList<string> Cues,double? FormulaPercent,BodyFatEstimateInputs InputsUsed);

/// A transient suggestion: nothing is stored except the shared AI allowance counter.
/// Inline images stay in memory and are never written to photo storage.
public sealed class BodyFatEstimateService(AppDb db,GcsPhotoStore store,BodyRecordService body,BodyCompositionAi ai)
{
    private static readonly string[] Angles=["front","side","back"];

    public async Task<BodyFatEstimateView> Estimate(BodyFatEstimateInput input,CancellationToken ct)
    {
        var uid=db.CurrentUser??throw new DomainException("Sign in again.",401);
        var photos=input.Photos??[];
        Validation.Require(photos.Count==3&&Angles.All(angle=>photos.Count(p=>p.Angle==angle)==1),"Add front, side, and back photos to estimate body fat.");
        Validation.Require(photos.All(p=>(p.PhotoId is null)!=(p.ImageBase64 is null)),"Each view needs either a saved photo or a new image.");
        var measurements=new BodyMeasurements();
        BodyRecordService.ApplyMeasurements(measurements,input.Measurements);
        var inline=photos.Where(p=>p.ImageBase64!=null).ToDictionary(p=>p.Angle,p=>PhotoService.DecodeJpeg(p.ImageBase64));

        var user=await db.Users.AsNoTracking().SingleAsync(u=>u.Id==uid,ct);
        var weight=await body.Capture(input.Date,ct);
        var images=new Dictionary<string,byte[]>(inline);
        foreach(var saved in photos.Where(p=>p.PhotoId!=null))
        {
            // The tenancy filter scopes this lookup to the signed-in account.
            var photo=await db.Photos.AsNoTracking().SingleOrDefaultAsync(p=>p.Id==saved.PhotoId&&p.Angle==saved.Angle&&!p.Deleted&&p.Status=="complete",ct)
                ??throw new DomainException("Photo not found.",404);
            images[saved.Angle]=await store.Get(photo.ObjectPath,ct);
        }

        var profile=user.ProfileJson.Length==0?null:Json.Read<Profile>(user.ProfileJson);
        var sex=profile?.Sex is "male" or "female"?profile.Sex:null;
        var height=profile is {HeightCm:>0}?profile.HeightCm:(double?)null;
        int? age=profile is {DateOfBirth:not null}||profile is {Age:>0}?Coach.AgeAt(profile,RetentionService.Today(user.ProfileJson)):null;
        var recorded=BodyRecordService.MeasurementFields
            .Where(field=>field.Key!="bodyFatPercent"&&field.Value.GetValue(measurements) is double)
            .Select(field=>new KeyValuePair<string,double>(field.Key,(double)field.Value.GetValue(measurements)!)).ToList();
        var formula=BodyFatFormulas.Navy(sex,height,measurements.NeckCm,measurements.WaistCm,measurements.HipsCm);
        var context=new BodyCompositionContext(sex,age,height,weight.ScaleKg,weight.TrendKg,formula,recorded);

        var day=await AiAllowance.Reserve(db,ct);
        var result=await ai.Estimate(new BodyCompositionPhotos(images["front"],images["side"],images["back"]),context,ct);
        await AiAllowance.RecordTokens(db,day,result.InputTokens,result.CachedInputTokens,result.OutputTokens);
        var estimate=result.Estimate;
        return new(estimate.EstimatePercent!.Value,estimate.LowPercent!.Value,estimate.HighPercent!.Value,estimate.Confidence,
            estimate.Explanation,estimate.Cues,formula,
            new BodyFatEstimateInputs(3,height,sex,age,weight.ScaleKg,weight.TrendKg,recorded.Select(item=>item.Key).ToList()));
    }
}

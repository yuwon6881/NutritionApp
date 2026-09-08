using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;

namespace Nutrition.Api.Endpoints;
public record AcceptInput(Guid Id,long Revision);
public static class RecordEndpoints
{
    public static void MapRecords(this WebApplication app)
    {
        app.MapGet("/api/state",async(AppDb db,RetentionService retention,DateOnly? date,int? year,CancellationToken ct) =>
        {
            var user=await db.Users.SingleAsync(u=>u.Id==db.CurrentUser,ct);
            var today=DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);
            var end=date?.AddDays(1)??today; var start=end.AddDays(-90);
            if(year is {} y){Validation.Require(y>=2000&&y<=today.Year,"Choose a supported history year.");start=new(y,1,1);end=new(y,12,31);}
            var energyPlans=await db.Plans.Where(p=>p.Date>=start&&p.Date<=end).OrderBy(p=>p.Date).ThenBy(p=>p.Revision).ToListAsync(ct);
            var precedingPlan=await db.Plans.Where(p=>p.Date<start).OrderByDescending(p=>p.Date).ThenByDescending(p=>p.Revision).FirstOrDefaultAsync(ct);
            if(precedingPlan!=null)energyPlans.Insert(0,precedingPlan);
            return Results.Ok(new {
                user.Id,user.Username,user.Revision,user.ProfileRevision,
                profile=user.ProfileJson.Length==0?null:Json.Read<Profile>(user.ProfileJson), start,end,
                detailCutoff=RetentionService.Cutoff(RetentionService.Today(user.ProfileJson),retention.DetailDays),detailDays=retention.DetailDays,
                energyEstimates=energyPlans.Select(p=>new { p.Date,p.Revision,expenditure=Json.Read<CoachResult>(p.ResultJson).Expenditure }).Where(p=>p.expenditure!=null),
                entries=await db.Entries.Where(e=>e.Date>=start&&e.Date<=end).OrderBy(e=>e.Date).ThenBy(e=>e.Id).ToListAsync(ct),
                foods=await db.Foods.OrderBy(f=>f.Name).Take(1000).ToListAsync(ct),
                weights=await db.Weights.Where(w=>w.Date>=start&&w.Date<=end).OrderBy(w=>w.Date).ToListAsync(ct),
                weightTrendSeed=await db.Weights.Where(w=>w.Date>=start.AddDays(-56)&&w.Date<start&&!w.Deleted).OrderBy(w=>w.Date).ToListAsync(ct),
                days=await db.Days.Where(d=>d.Date>=start&&d.Date<=end).ToListAsync(ct),
                plans=await db.Plans.OrderByDescending(p=>p.Revision).Take(12).ToListAsync(ct)
            });
        });
        app.MapPost("/api/sync",async(Mutation mutation,SyncService sync,CancellationToken ct)=>Results.Ok(new { revision=await sync.Apply(mutation,ct) }));
        app.MapGet("/api/coach/preview",async(CoachingService coach,CancellationToken ct)=>await coach.Preview(ct));
        app.MapPost("/api/coach/accept",async(AcceptInput input,CoachingService coach,CancellationToken ct)=>await coach.Accept(input.Id,input.Revision,ct));
        app.MapGet("/api/export",async(AppDb db,CancellationToken ct)=>
        {
            var user=await db.Users.SingleAsync(u=>u.Id==db.CurrentUser,ct);
            var data=new { schemaVersion=1,exportedAt=DateTime.UtcNow,profile=user.ProfileJson,
                entries=await db.Entries.Where(x=>!x.Deleted).ToListAsync(ct),foods=await db.Foods.Where(x=>!x.Deleted).ToListAsync(ct),
                weights=await db.Weights.Where(x=>!x.Deleted).ToListAsync(ct),days=await db.Days.Where(x=>!x.Deleted).ToListAsync(ct),plans=await db.Plans.ToListAsync(ct),
                physiquePhotos=await db.Photos.Where(x=>!x.Deleted&&x.Status=="complete").Select(x=>new { x.Id,x.Date,x.Caption,x.Angle,x.Bytes,downloadPath="/api/photos/"+x.Id+"/content" }).ToListAsync(ct) };
            return Results.File(System.Text.Encoding.UTF8.GetBytes(Json.Write(data)),"application/json","nutrition-export.json");
        });
    }
}

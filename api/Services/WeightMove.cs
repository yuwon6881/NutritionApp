using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record WeightMoveInput(DateOnly Date,double Kg,string? Context=null,Guid? DestinationId=null,long? DestinationRevision=null);

public sealed partial class SyncService
{
    private async Task<long> ApplyWeightMove(Mutation op,CancellationToken ct)
    {
        var uid=db.CurrentUser??throw new DomainException("Sign in again.",401);
        Validation.Require(op.Id!=Guid.Empty&&op.RecordId!=Guid.Empty&&!op.Delete,"A weight move identity is required.");
        var hash=AuthService.Hash(Json.Write(op));
        await using var gate=await MutationLock.Acquire(db,uid,ct);
        var receipt=await db.Receipts.SingleOrDefaultAsync(r=>r.Id==op.Id,ct);
        if(receipt!=null){Validation.Require(receipt.Hash==hash,"Idempotency key reused for different data.",409);return receipt.Revision;}
        var user=await db.Users.SingleAsync(u=>u.Id==uid,ct);
        var input=op.Data.Deserialize<WeightMoveInput>(Json.Options)??throw new DomainException("Weight move is required.");
        Date(input.Date,user.ProfileJson);Validation.Number(input.Kg,20,400,"Weight");
        Validation.Require(WeightContextPolicy.IsValid(input.Context),"Choose a valid weigh-in context.");
        var source=await db.Weights.SingleOrDefaultAsync(w=>w.Id==op.RecordId,ct);
        Validation.Require(source!=null&&!source.Deleted&&source.Revision==op.ExpectedRevision,"The source weigh-in changed. Review before moving.",409);
        var destination=await db.Weights.SingleOrDefaultAsync(w=>w.Date==input.Date&&w.Id!=op.RecordId,ct);
        Validation.Require(destination==null?input.DestinationId==null:
            destination.Deleted&&input.DestinationId==null||destination.Id==input.DestinationId&&destination.Revision==input.DestinationRevision,
            "The destination weigh-in changed. Review before moving.",409);
        var previousSource=Snapshot(source!);
        var previousDestination=destination==null?null:Snapshot(destination);
        var revision=++user.Revision;
        var target=destination??source!;
        target.Date=input.Date;target.Kg=input.Kg;target.Context=input.Context;target.Source=WeightSources.Manual;
        target.Deleted=false;target.Revision=revision;
        if(destination!=null){source!.Deleted=true;source.Revision=revision;}
        if(weightSync!=null)
        {
            if(destination!=null)await weightSync.QueueMutationAsync(previousSource,
                new Mutation(op.Id,"weight",source!.Id,op.ExpectedRevision,JsonSerializer.SerializeToElement(previousSource,Json.Options),true),revision,ct);
            await weightSync.QueueMutationAsync(previousDestination??previousSource,
                new Mutation(op.Id,"weight",target.Id,previousDestination?.Revision??op.ExpectedRevision,JsonSerializer.SerializeToElement(target,Json.Options)),revision,ct);
        }
        user.TrajectoryRevision=revision;
        if(trajectory!=null)await trajectory.RebuildFromUnderLock(input.Date<previousSource.Date?input.Date:previousSource.Date,revision,ct);
        await db.SaveChangesAsync(ct);
        var canonical=Json.Write(await SyncWriteResults.Capture(db,op,revision,ct));
        db.Receipts.Add(new MutationReceipt{Id=op.Id,UserId=uid,Hash=hash,Revision=revision,CanonicalJson=canonical});
        await db.SaveChangesAsync(ct);await gate.Commit(ct);return revision;
    }
    private static Weight Snapshot(Weight value)=>new(){Id=value.Id,UserId=value.UserId,Date=value.Date,Kg=value.Kg,
        Context=value.Context,Source=value.Source,ExternalId=value.ExternalId,Revision=value.Revision,Deleted=value.Deleted};
}

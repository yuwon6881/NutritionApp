using Nutrition.Api.Domain;
namespace Nutrition.Api.Services;
public sealed class TemporaryImageStore(HttpClient http,IConfiguration config,Func<CancellationToken,Task<string>>? accessToken=null)
{
    private readonly GcsObjectStore store=new(http,config["ScanStorage:Bucket"],accessToken);
    public async Task Put(string path,byte[] bytes,CancellationToken ct)
    {
        Validation.Require(store.Configured,"Temporary Google Cloud scan storage is not configured.",503);
        Validation.Require(bytes.Length is >3 and <=1_500_000,"Photo must be at most 1.5 MB.");
        Validation.Require(bytes[0]==0xff&&bytes[1]==0xd8&&bytes[2]==0xff,"Upload a processed JPEG photo.");
        try { await store.Put(path,bytes,ct); }
        catch(DomainException ex) when(ex.Status==409)
        {
            // The job identity and input hash are persisted before upload. Accept a previous
            // successful upload only after matching its bytes to this retry.
            var existing=await store.Get(path,ct);
            if(!existing.AsSpan().SequenceEqual(bytes))throw;
        }
    }
    public Task<byte[]> Get(string path,CancellationToken ct)=>store.Get(path,ct);
    public Task Delete(string path,CancellationToken ct)=>store.Delete(path,ct);
    public Task<int> DeleteAllVersionsUnder(string prefix,CancellationToken ct)=>store.DeleteAllVersionsUnder(prefix,ct);
}

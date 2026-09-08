using System.Net;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Services;
using Xunit;
namespace Nutrition.Tests;
public class GcsPhotoTests
{
    [Fact] public async Task Scan_storage_uses_its_own_bucket_and_rejects_non_jpeg_before_upload()
    {
        var handler=new Handler();
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"ScanStorage:Bucket","temporary-scans"},{"Physique:Bucket","permanent-photos"}}).Build();
        var store=new TemporaryImageStore(new HttpClient(handler),config,_=>Task.FromResult("test-token"));
        await Assert.ThrowsAsync<Nutrition.Api.Domain.DomainException>(()=>store.Put("nutrition-scans/user/image.jpg",[1,2,3,4],default));
        Assert.Empty(handler.Requests);
        await store.Put("nutrition-scans/user/image.jpg",[0xff,0xd8,0xff,0x00],default);
        await store.Delete("nutrition-scans/user/image.jpg",default);
        Assert.All(handler.Requests,r=>Assert.Contains("temporary-scans",r.Url));
        Assert.Contains("generation=12345",handler.Requests[^1].Url);
    }
    private sealed class Handler:HttpMessageHandler
    {
        public List<(HttpMethod Method,string Url,string? Authorization)> Requests { get; }=[];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        { Requests.Add((request.Method,request.RequestUri!.OriginalString,request.Headers.Authorization?.ToString()));return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=request.RequestUri.Query.Contains("fields=generation")?new StringContent("{\"generation\":\"12345\"}"):new ByteArrayContent([1,2,3])}); }
    }
    [Fact] public async Task Private_gcs_transport_uses_encoded_immutable_paths_and_bearer_auth()
    {
        var handler=new Handler();var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"Physique:Bucket","private-test-bucket"}}).Build();
        var store=new GcsPhotoStore(new HttpClient(handler),config,_=>Task.FromResult("test-token"));
        await store.Put("nutrition-physique/user/photo.jpg",[1,2,3],default);
        Assert.Equal(new byte[]{1,2,3},await store.Get("nutrition-physique/user/photo.jpg",default));
        await store.Delete("nutrition-physique/user/photo.jpg",default);
        Assert.All(handler.Requests,r=>Assert.Equal("Bearer test-token",r.Authorization));
        Assert.Contains("ifGenerationMatch=0",handler.Requests[0].Url);
        Assert.Contains(Uri.EscapeDataString("nutrition-physique/user/photo.jpg"),handler.Requests[1].Url);
        Assert.Contains("generation=12345",handler.Requests[^1].Url);
    }
}

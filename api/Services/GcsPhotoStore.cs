namespace Nutrition.Api.Services;
public sealed class GcsPhotoStore(HttpClient http,IConfiguration config,Func<CancellationToken,Task<string>>? accessToken=null)
    : GcsObjectStore(http,config["Physique:Bucket"],accessToken);

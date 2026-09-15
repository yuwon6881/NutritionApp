using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Endpoints;
using Nutrition.Api.Services;
using OpenIddict.Validation.AspNetCore;

var builder=WebApplication.CreateBuilder(args);
if(int.TryParse(Environment.GetEnvironmentVariable("PORT"),out var cloudRunPort))builder.WebHost.UseUrls($"http://0.0.0.0:{cloudRunPort}");
builder.Configuration.AddJsonFile("appsettings.Local.json",optional:true,reloadOnChange:false);
if(!builder.Environment.IsDevelopment()&&(!Uri.TryCreate(builder.Configuration["PublicOrigin"],UriKind.Absolute,out var publicOrigin)||publicOrigin.Scheme!="https"))
    throw new InvalidOperationException("PublicOrigin must be the exact public HTTPS origin in production.");
builder.WebHost.ConfigureKestrel(o=>o.Limits.MaxRequestBodySize=2_200_000);
builder.Services.Configure<ForwardedHeadersOptions>(o=> { o.ForwardedHeaders=ForwardedHeaders.XForwardedProto; });
builder.Services.AddDbContext<AppDb>(o=>
{
    var connection=builder.Configuration.GetConnectionString("Database");
    if(!string.IsNullOrWhiteSpace(connection)) o.UseNpgsql(ConnectionSettings.Normalize(connection));
    else if(builder.Environment.IsDevelopment()) o.UseSqlite("Data Source="+(builder.Configuration["Database:SqlitePath"]??"nutrition.db"));
    else throw new InvalidOperationException("ConnectionStrings:Database must be configured in production.");
});
builder.Services.AddScoped<AuthService>();builder.Services.AddScoped<ExpenditureTrajectoryService>();builder.Services.AddScoped<SyncService>();builder.Services.AddScoped<CoachingService>();
builder.Services.AddScoped<ScanService>();builder.Services.AddScoped<StorageService>();
builder.Services.AddScoped<RetentionService>();
builder.Services.AddScoped<ExportService>();
builder.Services.AddScoped<PhotoService>();builder.Services.AddScoped<ProgressSummaryService>();
builder.Services.AddScoped<BodyRecordService>();
builder.Services.AddScoped<SharedAccessTokenService>();builder.Services.AddScoped<OpenIddictAccessTokenService>();builder.Services.AddScoped<IntegrationTokenService>();builder.Services.AddScoped<TrainingContextService>();
builder.Services.AddScoped<WorkoutSummaryService>();
builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme;
});
builder.Services.AddOpenIddict().AddValidation(options =>
{
    options.SetIssuer(new Uri(builder.Configuration["Identity:Issuer"] ?? "http://fitness-account"));
    options.AddAudiences(
        builder.Configuration["Identity:NutritionAudience"] ?? "nutrition-api",
        builder.Configuration["Identity:WorkoutAudience"] ?? "workout-api");
    options.UseSystemNetHttp();
    options.UseAspNetCore();
});
builder.Services.AddHttpClient<GcsPhotoStore>(c=>c.Timeout=TimeSpan.FromSeconds(45));
builder.Services.AddMemoryCache(o=>o.SizeLimit=256);
// Open Food Facts asks every read to identify its caller or risk being served as a bot, and both
// food search and barcode lookup now go there, so the identity belongs on the shared client.
builder.Services.AddHttpClient<FoodSearchService>(c=>{
  c.Timeout=TimeSpan.FromSeconds(20);
  c.DefaultRequestHeaders.UserAgent.ParseAdd("NutritionCoach/1.0 (two-user personal nutrition tracker)");
});
builder.Services.AddHttpClient<TemporaryImageStore>(c=>c.Timeout=TimeSpan.FromSeconds(30));
builder.Services.AddHttpClient<NutritionAi>(c=>c.Timeout=TimeSpan.FromSeconds(90));
builder.Services.AddHttpClient<IGoogleHealthKms, GoogleCloudKmsService>(c=>c.Timeout=TimeSpan.FromSeconds(30));
builder.Services.AddHttpClient<GoogleHealthService>(c=>c.Timeout=TimeSpan.FromSeconds(30));
builder.Services.AddHttpClient("workout", c=>c.Timeout=TimeSpan.FromSeconds(3));
builder.Services.AddHttpClient("fitness-account", c=>c.Timeout=TimeSpan.FromSeconds(10));
builder.Services.AddRateLimiter(o=>
{
    o.RejectionStatusCode=429;
    o.AddPolicy("export",http=>RateLimitPartition.GetFixedWindowLimiter(
        string.IsNullOrEmpty(http.Request.Cookies[AuthService.Cookie])
            ? "unauthenticated"
            : AuthService.Hash(http.Request.Cookies[AuthService.Cookie]!),
        _=>new FixedWindowRateLimiterOptions { PermitLimit=5,Window=TimeSpan.FromMinutes(5),QueueLimit=0 }));
});
var app=builder.Build();
app.UseForwardedHeaders();
app.UseAuthentication();
app.Use(async(http,next)=>
{
    http.Response.Headers.XContentTypeOptions="nosniff";
    if(!app.Environment.IsDevelopment()) http.Response.Headers.StrictTransportSecurity="max-age=31536000";
    http.Response.Headers["Referrer-Policy"]="same-origin";
    http.Response.Headers.ContentSecurityPolicy="default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    if(http.Request.Path.StartsWithSegments("/api")) http.Response.Headers.CacheControl="no-store";
    try
    {
        if((HttpMethods.IsPost(http.Request.Method)||HttpMethods.IsDelete(http.Request.Method))&&!http.Request.Path.StartsWithSegments("/internal"))
        {
            var origin=http.Request.Headers.Origin.ToString();
            var allowed=builder.Configuration["PublicOrigin"]??$"{http.Request.Scheme}://{http.Request.Host}";
            Validation.Require(origin==allowed&&http.Request.Headers["X-Nutrition-Request"]=="1","Request origin is not allowed.",403);
        }
        if(http.Request.Path.StartsWithSegments("/internal"))
        {
            var expected=builder.Configuration["Cleanup:Token"];
            var supplied=http.Request.Headers["X-Cleanup-Token"].ToString();
            Validation.Require(!string.IsNullOrEmpty(expected)&&System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(supplied),System.Text.Encoding.UTF8.GetBytes(expected)),"Scheduler authentication required.",401);
        }
        else if(http.Request.Path.StartsWithSegments("/api") && !http.Request.Path.StartsWithSegments("/api/integrations/v1") && http.Request.Path.Value is not ("/api/auth/dev-reset" or "/api/auth/central/start" or "/api/auth/central/callback" or "/api/integrations/google-health/callback"))
        {
            var db=http.RequestServices.GetRequiredService<AppDb>();
            var token=http.Request.Cookies[AuthService.Cookie];
            Validation.Require(!string.IsNullOrEmpty(token),"Sign in to sync your diary.",401);
            var hash=AuthService.Hash(token!);
            var session=await db.Sessions.AsNoTracking().SingleOrDefaultAsync(s=>s.Hash==hash&&s.Expires>DateTime.UtcNow,http.RequestAborted);
            Validation.Require(session!=null,"Your session expired. Local work is retained; sign in again.",401);db.CurrentUser=session!.UserId;
        }
        await next();
    }
    catch(DomainException ex) { http.Response.StatusCode=ex.Status;await http.Response.WriteAsJsonAsync(new { message=ex.Message }); }
    catch(DbUpdateException) { http.Response.StatusCode=409;await http.Response.WriteAsJsonAsync(new { message="This record conflicts with saved data. Refresh and review before retrying." }); }
    catch(System.Text.Json.JsonException) { http.Response.StatusCode=400;await http.Response.WriteAsJsonAsync(new { message="Invalid data format." }); }
});
app.UseRateLimiter();
app.UseDefaultFiles();app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse=c=> { if(c.File.Name=="sw.js"||c.File.Name=="index.html") c.Context.Response.Headers.CacheControl="no-cache"; } });
app.MapAuth();app.MapCentralAuth();app.MapRecords();app.MapAi();app.MapPhotos();app.MapBodyRecords();app.MapGoogleHealth();app.MapIntegrations();
app.MapGet("/health",()=>new { status="ok" });
app.MapFallback(async http=>
{
    if(http.Request.Path.StartsWithSegments("/api")||Path.HasExtension(http.Request.Path)) { http.Response.StatusCode=404;return; }
    var file=Path.Combine(app.Environment.WebRootPath??"wwwroot","index.html");
    if(!File.Exists(file)) { http.Response.StatusCode=404;return; }
    http.Response.ContentType="text/html";http.Response.Headers.CacheControl="no-cache";await http.Response.SendFileAsync(file);
});
await using(var scope=app.Services.CreateAsyncScope())
{
    var db=scope.ServiceProvider.GetRequiredService<AppDb>();
    if(db.Database.IsSqlite()&&app.Environment.IsDevelopment()) await db.Database.EnsureCreatedAsync();
    else if(builder.Configuration.GetValue("Database:MigrateOnStartup",true)||args.Contains("--migrate-only"))
    {
        var rawConn=builder.Configuration.GetConnectionString("Database");
        if(!string.IsNullOrWhiteSpace(rawConn))
        {
            var directConn=ConnectionSettings.Direct(rawConn);
            await using var migrateDb=new AppDb(new DbContextOptionsBuilder<AppDb>().UseNpgsql(directConn).Options);
            await migrateDb.Database.MigrateAsync();
        }
        else
        {
            await db.Database.MigrateAsync();
        }
    }
}
if(args.Contains("--migrate-only")) return;
app.Run();
public partial class Program;

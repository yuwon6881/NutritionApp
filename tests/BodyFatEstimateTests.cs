using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class BodyFatEstimateTests
{
    private static readonly byte[] Jpeg=[0xff,0xd8,0x01,0x02,0x03,0xff,0xd9];
    private static string JpegBase64=>Convert.ToBase64String(Jpeg);

    [Fact]
    public void Navy_formula_uses_metric_circumferences_and_leaves_missing_inputs_unknown()
    {
        Assert.Equal(16.4,BodyFatFormulas.Navy("male",178,38,85,null)!.Value,1);
        Assert.Equal(28.4,BodyFatFormulas.Navy("female",165,33,75,98)!.Value,1);
        Assert.Null(BodyFatFormulas.Navy("female",165,33,75,null));
        Assert.Null(BodyFatFormulas.Navy("male",null,38,85,null));
        Assert.Null(BodyFatFormulas.Navy("",178,38,85,null));
        Assert.Null(BodyFatFormulas.Navy("male",178,40,39,null));
    }

    [Fact]
    public async Task Ai_allowance_is_shared_and_stops_at_the_daily_cap()
    {
        var (db,_)=await CreateDbAsync();
        await using(db)
        {
            var config=Config(new() {["OpenAi:DailyRequestsPerUser"]="2"});
            await AiAllowance.Reserve(db,config,default);
            await AiAllowance.Reserve(db,config,default);
            var denied=await Assert.ThrowsAsync<DomainException>(()=>AiAllowance.Reserve(db,config,default));
            Assert.Equal(429,denied.Status);
            Assert.Equal(2,(await db.Usage.SingleAsync()).Requests);
        }
    }

    [Fact]
    public async Task Ai_allowance_reserves_worst_case_cost_against_the_monthly_budget()
    {
        var (db,_)=await CreateDbAsync();
        await using(db)
        {
            var config=Config(new() {["OpenAi:MonthlyBudgetUsd"]="0.5",["OpenAi:ReservedCostPerRequestUsd"]="0.25"});
            await AiAllowance.Reserve(db,config,default);
            await AiAllowance.Reserve(db,config,default);
            var denied=await Assert.ThrowsAsync<DomainException>(()=>AiAllowance.Reserve(db,config,default));
            Assert.Equal(429,denied.Status);
        }
    }

    [Fact]
    public async Task Estimate_uses_server_profile_and_weight_and_never_stores_inline_photos()
    {
        var (db,user)=await CreateDbAsync(new Profile {HeightCm=178,Sex="male",DateOfBirth=new DateOnly(1994,3,14),WeightKg=80});
        await using(db)
        {
            var date=DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));
            db.Weights.Add(new Weight {Id=Guid.NewGuid(),UserId=user.Id,Date=date,Kg=79.5});
            await db.SaveChangesAsync();
            var storage=new StoreHandler();
            string? providerRequest=null;
            var service=Service(db,storage,request=>{providerRequest=request;return Reply(AssessableJson);});

            var result=await service.Estimate(Input(date,new() {{"neckCm",38},{"waistCm",85}}),default);

            Assert.Equal(17.5,result.EstimatePercent);
            Assert.Equal(15.5,result.LowPercent);
            Assert.Equal(19.5,result.HighPercent);
            Assert.Equal("medium",result.Confidence);
            Assert.Equal(16.4,result.FormulaPercent!.Value,1);
            Assert.Equal(3,result.InputsUsed.Photos);
            Assert.Equal(178,result.InputsUsed.HeightCm);
            Assert.Equal("male",result.InputsUsed.Sex);
            Assert.NotNull(result.InputsUsed.Age);
            Assert.Equal(79.5,result.InputsUsed.ScaleKg);
            Assert.Equal(["neckCm","waistCm"],result.InputsUsed.MeasurementKeys);
            Assert.Equal(0,storage.Writes);
            using var request=JsonDocument.Parse(providerRequest!);
            Assert.False(request.RootElement.GetProperty("store").GetBoolean());
            var content=request.RootElement.GetProperty("input")[0].GetProperty("content");
            Assert.Equal(3,content.EnumerateArray().Count(part=>part.GetProperty("type").GetString()=="input_image"));
            Assert.Contains("Height: 178 cm",content[0].GetProperty("text").GetString());
            Assert.Equal(1,(await db.Usage.SingleAsync()).Requests);
        }
    }

    [Fact]
    public async Task Estimate_lists_missing_profile_values_as_unused_instead_of_defaulting()
    {
        var (db,_)=await CreateDbAsync();
        await using(db)
        {
            var service=Service(db,new StoreHandler(),_=>Reply(AssessableJson));
            var result=await service.Estimate(Input(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),null),default);
            Assert.Null(result.InputsUsed.HeightCm);
            Assert.Null(result.InputsUsed.Sex);
            Assert.Null(result.InputsUsed.Age);
            Assert.Null(result.InputsUsed.ScaleKg);
            Assert.Null(result.FormulaPercent);
            Assert.Empty(result.InputsUsed.MeasurementKeys);
        }
    }

    [Fact]
    public async Task Estimate_requires_exactly_one_usable_photo_per_angle()
    {
        var (db,_)=await CreateDbAsync();
        await using(db)
        {
            var calls=0;
            var service=Service(db,new StoreHandler(),_=>{calls++;return Reply(AssessableJson);});
            var date=DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));
            var inline=new BodyFatEstimatePhoto("front",null,JpegBase64);

            await Assert.ThrowsAsync<DomainException>(()=>service.Estimate(new(date,[inline,inline with {Angle="side"}],null),default));
            await Assert.ThrowsAsync<DomainException>(()=>service.Estimate(new(date,[inline,inline,inline with {Angle="back"}],null),default));
            await Assert.ThrowsAsync<DomainException>(()=>service.Estimate(new(date,[inline with {PhotoId=Guid.NewGuid()},inline with {Angle="side"},inline with {Angle="back"}],null),default));
            await Assert.ThrowsAsync<DomainException>(()=>service.Estimate(new(date,[inline with {ImageBase64=Convert.ToBase64String([1,2,3,4,5,6])},inline with {Angle="side"},inline with {Angle="back"}],null),default));
            var unknown=await Assert.ThrowsAsync<DomainException>(()=>service.Estimate(new(date,[new("front",Guid.NewGuid(),null),inline with {Angle="side"},inline with {Angle="back"}],null),default));
            Assert.Equal(404,unknown.Status);
            await Assert.ThrowsAsync<DomainException>(()=>service.Estimate(Input(date,new() {{"waistCm",-3}}),default));
            Assert.Equal(0,calls);
            Assert.Empty(await db.Usage.ToListAsync());
        }
    }

    [Fact]
    public async Task Estimate_reads_existing_photos_only_from_the_signed_in_account()
    {
        var (db,user)=await CreateDbAsync();
        await using(db)
        {
            var other=await TestUsers.CreateAsync(db,"other-user");
            var mine=new PhysiquePhoto {Id=Guid.NewGuid(),UserId=user.Id,SetId=Guid.NewGuid(),Date=new DateOnly(2026,9,1),Angle="front",Status="complete",Bytes=7,ObjectPath="nutrition-physique/mine.jpg"};
            var theirs=new PhysiquePhoto {Id=Guid.NewGuid(),UserId=other.Id,SetId=Guid.NewGuid(),Date=new DateOnly(2026,9,1),Angle="front",Status="complete",Bytes=7,ObjectPath="nutrition-physique/theirs.jpg"};
            db.CurrentUser=other.Id;db.Photos.Add(theirs);await db.SaveChangesAsync();
            db.CurrentUser=user.Id;db.Photos.Add(mine);await db.SaveChangesAsync();
            var storage=new StoreHandler();
            var service=Service(db,storage,_=>Reply(AssessableJson));
            var date=DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1));
            var side=new BodyFatEstimatePhoto("side",null,JpegBase64);

            var foreign=await Assert.ThrowsAsync<DomainException>(()=>service.Estimate(new(date,[new("front",theirs.Id,null),side,side with {Angle="back"}],null),default));
            Assert.Equal(404,foreign.Status);
            var wrongAngle=await Assert.ThrowsAsync<DomainException>(()=>service.Estimate(new(date,[new("back",mine.Id,null),side,side with {Angle="front"}],null),default));
            Assert.Equal(404,wrongAngle.Status);

            var result=await service.Estimate(new(date,[new("front",mine.Id,null),side,side with {Angle="back"}],null),default);
            Assert.Equal(17.5,result.EstimatePercent);
            Assert.Equal(["nutrition-physique%2Fmine.jpg"],storage.Reads);
        }
    }

    [Theory]
    [InlineData("""{"assessable":false,"estimatePercent":null,"lowPercent":null,"highPercent":null,"confidence":"low","explanation":"The body is not visible.","cues":[]}""")]
    [InlineData("""{"assessable":true,"estimatePercent":80,"lowPercent":75,"highPercent":85,"confidence":"low","explanation":"x","cues":[]}""")]
    [InlineData("""{"assessable":true,"estimatePercent":18,"lowPercent":20,"highPercent":22,"confidence":"low","explanation":"x","cues":[]}""")]
    [InlineData("""{"assessable":true,"estimatePercent":18,"lowPercent":5,"highPercent":30,"confidence":"low","explanation":"x","cues":[]}""")]
    [InlineData("""{"assessable":true,"estimatePercent":18,"lowPercent":16,"highPercent":20,"confidence":"certain","explanation":"x","cues":[]}""")]
    public async Task Provider_output_outside_the_contract_is_rejected(string output)
    {
        var (db,_)=await CreateDbAsync();
        await using(db)
        {
            var service=Service(db,new StoreHandler(),_=>Reply(output));
            var error=await Assert.ThrowsAsync<DomainException>(()=>service.Estimate(Input(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),null),default));
            Assert.Equal(422,error.Status);
        }
    }

    [Fact]
    public async Task Provider_refusal_reports_unusable_photos()
    {
        var (db,_)=await CreateDbAsync();
        await using(db)
        {
            var service=Service(db,new StoreHandler(),_=>new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content=new StringContent("""{"status":"completed","output":[{"content":[{"type":"refusal","refusal":"I can't help with that."}]}]}""")
            });
            var error=await Assert.ThrowsAsync<DomainException>(()=>service.Estimate(Input(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),null),default));
            Assert.Equal(422,error.Status);
            Assert.Contains("front, side, and back",error.Message);
        }
    }

    private const string AssessableJson="""{"assessable":true,"estimatePercent":17.5,"lowPercent":15.5,"highPercent":19.5,"confidence":"medium","explanation":"Visible upper abdominal outline with soft lower abdomen.","cues":["Faint upper abdominal outline","Some flank fat"]}""";

    private static BodyFatEstimateInput Input(DateOnly date,Dictionary<string,double?>? measurements)
        =>new(date,new[] {"front","side","back"}.Select(angle=>new BodyFatEstimatePhoto(angle,null,JpegBase64)).ToList(),measurements);

    private static HttpResponseMessage Reply(string output)=>new(HttpStatusCode.OK)
    {
        Content=new StringContent(JsonSerializer.Serialize(new
        {
            status="completed",
            output=new[] {new {content=new[] {new {type="output_text",text=output}}}},
            usage=new {input_tokens=10,output_tokens=5}
        }))
    };

    private static IConfiguration Config(Dictionary<string,string?>? values=null)
    {
        var all=new Dictionary<string,string?> {["OpenAi:ApiKey"]="test-key",["Physique:Bucket"]="test-bucket"};
        foreach(var (key,value) in values??new Dictionary<string,string?>())all[key]=value;
        return new ConfigurationBuilder().AddInMemoryCollection(all).Build();
    }

    private static BodyFatEstimateService Service(AppDb db,StoreHandler storage,Func<string,HttpResponseMessage> provider)
    {
        var config=Config();
        var store=new GcsPhotoStore(new HttpClient(storage),config,_=>Task.FromResult("token"));
        var ai=new BodyCompositionAi(new HttpClient(new ProviderHandler(provider)),config);
        return new BodyFatEstimateService(db,store,new BodyRecordService(db,store,config),ai,config);
    }

    private static async Task<(AppDb Db,AppUser User)> CreateDbAsync(Profile? profile=null)
    {
        var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"body-fat-user");
        if(profile!=null){user.ProfileJson=Json.Write(profile);await db.SaveChangesAsync();}
        db.CurrentUser=user.Id;
        return (db,user);
    }

    private sealed class StoreHandler:HttpMessageHandler
    {
        public int Writes;
        public List<string> Reads { get; } = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)
        {
            if(request.Method!=HttpMethod.Get){Writes++;return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));}
            Reads.Add(request.RequestUri!.AbsolutePath.Split("/o/")[1]);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) {Content=new ByteArrayContent(Jpeg)});
        }
    }

    private sealed class ProviderHandler(Func<string,HttpResponseMessage> reply):HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)
            =>reply(await request.Content!.ReadAsStringAsync(cancellationToken));
    }
}

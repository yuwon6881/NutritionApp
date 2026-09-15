using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

public static class PostgresVerification
{
    public static async Task Run(string connectionString)
    {
        var schema="nourish_verify_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connectionString);await admin.OpenAsync();
        await new NpgsqlCommand($"CREATE SCHEMA \"{schema}\"",admin).ExecuteNonQueryAsync();
        try
        {
            var scoped=new NpgsqlConnectionStringBuilder(connectionString){SearchPath=schema};
            AppDb Open(Guid? user=null)=>new(new DbContextOptionsBuilder<AppDb>().UseNpgsql(scoped.ConnectionString).AddInterceptors(new SchemaScope(schema)).Options){CurrentUser=user};
            await using(var create=Open())await create.Database.ExecuteSqlRawAsync(create.Database.GenerateCreateScript());
            var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Retention:MealDetailDays"]="7",["Auth:MaxUsers"]="2" }).Build();
            var registration=await Task.WhenAll(Enumerable.Range(0,8).Select(async i=>{await using var db=Open();try{var count=await db.Users.IgnoreQueryFilters().CountAsync();if(count>=config.GetValue("Auth:MaxUsers",2))throw new DomainException("Registration is closed.",403);var u=new AppUser{IdentitySubject="verify-subject-"+i,DisplayName="verify"+i};db.Users.Add(u);await db.SaveChangesAsync();return u;}catch(DomainException){return null;}}));
            var users=registration.Where(u=>u!=null).Cast<AppUser>().ToArray();Check(users.Length==2,"Concurrent registration exceeded two users.");
            await using(var db=Open(users[0].Id))
            {
                var sync=new SyncService(db);var date=DateOnly.FromDateTime(DateTime.UtcNow);
                var operation=new Mutation(Guid.NewGuid(),"weight",Guid.NewGuid(),0,JsonSerializer.SerializeToElement(new {date,kg=80}));
                var revision=await sync.Apply(operation,default);Check(await sync.Apply(operation,default)==revision,"Replay changed revision.");
                try{await sync.Apply(operation with {Id=Guid.NewGuid()},default);throw new Exception("Stale write accepted.");}catch(DomainException){}
            }
            await using(var db=Open(users[1].Id))Check(!await db.Weights.AnyAsync(),"Cross-user read leaked.");
            await using(var db=Open())Check(!await db.Weights.AnyAsync(),"Unauthenticated read leaked.");
            await using(var db=Open(users[0].Id))
            {
                var user=await db.Users.SingleAsync(u=>u.Id==users[0].Id);
                var profile=new Profile{Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="lose",Maintenance=2500};
                user.ProfileJson=Json.Write(profile);await db.SaveChangesAsync();
                var today=RetentionService.Today(user.ProfileJson);
                for(var i=1;i<=28;i++)
                {
                    db.Days.Add(new(){Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-i),Status="complete"});
                    db.Entries.Add(new(){Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-i),Name="Verified meal",Calories=2000,Quantity=1,Unit="serving"});
                    db.Weights.Add(new(){Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-i),Kg=80});
                }
                await db.SaveChangesAsync();var before=(await new CoachingService(db).Preview(default)).Result;
                var removed=await new RetentionService(db,config).CompactUser(user.Id,today,default);
                var after=(await new CoachingService(db).Preview(default)).Result;
                Check(before.Calories==after.Calories&&before.Expenditure==after.Expenditure&&removed==22,"Compaction changed coaching results.");
            }
            // Measure compact ten-year data in this isolated schema, never in the app tables.
            await using var sample=new NpgsqlConnection(scoped.ConnectionString);await sample.OpenAsync();
            await new NpgsqlCommand($"SET search_path TO \"{schema}\"",sample).ExecuteNonQueryAsync();
            await new NpgsqlCommand("""
                INSERT INTO "Days" ("UserId","Id","Revision","Deleted","Date","Status","Archived","EntryCount","Calories","Protein","Fat","Carbs","Fiber")
                SELECT u."Id",gen_random_uuid(),1,false,CURRENT_DATE-5000+i,'complete',true,20,2300,140,70,250,25 FROM "Users" u CROSS JOIN generate_series(0,3649) i;
                INSERT INTO "Weights" ("UserId","Id","Revision","Deleted","Date","Kg")
                SELECT u."Id",gen_random_uuid(),1,false,CURRENT_DATE-5000+i,80 FROM "Users" u CROSS JOIN generate_series(0,3649) i;
                """,sample).ExecuteNonQueryAsync();
            await using var size=new NpgsqlCommand("SELECT pg_database_size(current_database()), sum(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=@schema AND c.relkind='r'",sample);size.Parameters.AddWithValue("schema",schema);
            await using(var reader=await size.ExecuteReaderAsync())if(await reader.ReadAsync())Console.WriteLine(JsonSerializer.Serialize(new {registrationSlots=users.Length,tenancy=true,idempotency=true,compactionEquivalent=true,databaseBytes=reader.GetInt64(0),verificationSchemaTableAndIndexBytes=reader.GetDecimal(1),syntheticTenYearDailySummaries=7300,syntheticTenYearWeights=7300,note="Additional compact history, with indexes, in an isolated schema. Food libraries, all receipts/plans and photo metadata are not a full ten-year fixture."}));
        }
        finally
        {
            // The schema name is generated locally and never comes from user/configuration input.
            await new NpgsqlCommand($"DROP SCHEMA \"{schema}\" CASCADE",admin).ExecuteNonQueryAsync();
            Console.WriteLine("Isolated verification schema removed; application tables were not populated.");
        }
    }
    private static void Check(bool condition,string message){if(!condition)throw new InvalidOperationException(message);}
    private sealed class SchemaScope(string schema):DbConnectionInterceptor
    {
        public override async Task ConnectionOpenedAsync(DbConnection connection,ConnectionEndEventData eventData,CancellationToken ct=default)
        {
            await using var command=connection.CreateCommand();command.CommandText=$"SET search_path TO \"{schema}\"";await command.ExecuteNonQueryAsync(ct);
        }
    }
}

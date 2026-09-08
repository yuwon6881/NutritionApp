using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Nutrition.Api.Data;

if(args.Length!=2||args[0] is not ("inspect" or "inspect-pooled" or "migrate" or "verify"))throw new ArgumentException("Usage: DatabaseAdmin inspect|inspect-pooled|migrate|verify <private-config-path>");
using var config=JsonDocument.Parse(await File.ReadAllTextAsync(args[1]));
var url=config.RootElement.GetProperty("Url").GetString()!;
try
{
    var connectionString=args[0]=="inspect-pooled"?ConnectionSettings.Normalize(url):ConnectionSettings.Direct(url);
    if(args[0]=="verify"){await PostgresVerification.Run(connectionString);return;}
    await using var connection=new NpgsqlConnection(connectionString);await connection.OpenAsync();
    await using var command=new NpgsqlCommand("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",connection);
    var tables=new List<string>();await using(var reader=await command.ExecuteReaderAsync())while(await reader.ReadAsync())tables.Add(reader.GetString(0));
    Console.WriteLine(JsonSerializer.Serialize(new {host=connection.Host,database=connection.Database,publicTables=tables}));
    if(args[0]=="migrate")
    {
        var allowed=new HashSet<string>(["__EFMigrationsHistory","Users","Sessions","Entries","Foods","Weights","Days","Plans","Receipts","Scans","Usage","Photos"]);
        if(tables.Any(t=>!allowed.Contains(t)))throw new InvalidOperationException("Unexpected tables found; no migration applied.");
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseNpgsql(connectionString).Options);
        await db.Database.MigrateAsync();Console.WriteLine("Nutrition migrations applied.");
    }
    await using var size=new NpgsqlCommand("SELECT pg_database_size(current_database())",connection);
    Console.WriteLine(JsonSerializer.Serialize(new {databaseBytes=Convert.ToInt64(await size.ExecuteScalarAsync())}));
}
catch(Exception ex)
{
    Console.Error.WriteLine(ex is PostgresException postgres?$"PostgreSQL operation failed ({postgres.SqlState}): {postgres.MessageText}":"Database operation failed: "+ex.GetType().Name);
    Environment.ExitCode=1;
}

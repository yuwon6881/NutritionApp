using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Nutrition.Api.Data;

/// Local development uses SQLite, while deployed Nutrition uses PostgreSQL. Keep generated
/// migrations on the production provider even when no database is available during scaffolding.
public sealed class DesignTimeDbFactory : IDesignTimeDbContextFactory<AppDb>
{
    public AppDb CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("NUTRITION_DESIGN_DATABASE")
            ?? "Host=localhost;Database=nutrition_design;Username=nutrition;Password=nutrition";
        return new AppDb(new DbContextOptionsBuilder<AppDb>().UseNpgsql(connection).Options);
    }
}

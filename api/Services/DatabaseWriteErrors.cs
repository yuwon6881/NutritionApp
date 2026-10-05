using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using Npgsql;

namespace Nutrition.Api.Services;

public static class DatabaseWriteErrors
{
    public static bool IsConflict(DbUpdateException error) => error is DbUpdateConcurrencyException
        || error.InnerException is PostgresException { SqlState: "23505" or "23503" or "23514" }
        || error.InnerException is SqliteException { SqliteErrorCode: 19 };
}

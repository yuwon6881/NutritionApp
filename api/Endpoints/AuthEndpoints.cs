using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;

namespace Nutrition.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuth(this WebApplication app)
    {
        if (app.Environment.IsDevelopment())
        {
            app.MapPost("/api/auth/dev-reset", async (AppDb db, CancellationToken ct) =>
            {
                if (db.Database.IsSqlite())
                {
                    await db.Database.CloseConnectionAsync();
                    SqliteConnection.ClearAllPools();
                }
                await db.Database.EnsureDeletedAsync(ct);
                await db.Database.EnsureCreatedAsync(ct);
                return Results.Ok(new { reset = true });
            });
        }

        app.MapGet("/api/auth/me", async (AppDb db, CancellationToken ct) =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
            return new { user.Id, displayName = user.DisplayName };
        });

        app.MapPost("/api/auth/logout", async (AppDb db, HttpContext http, CancellationToken ct) =>
        {
            var hash = AuthService.Hash(http.Request.Cookies[AuthService.Cookie] ?? "");
            await db.Sessions.Where(s => s.Hash == hash).ExecuteDeleteAsync(ct);
            http.Response.Cookies.Delete(AuthService.Cookie, new CookieOptions { Path = "/" });
            return Results.NoContent();
        });
    }
}

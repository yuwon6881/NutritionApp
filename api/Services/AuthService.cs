using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services;

public sealed class AuthService(AppDb db, IMemoryCache cache)
{
    public const string Cookie = "nutrition-session";

    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string SessionCacheKey(string hash) => $"nutrition-session:{hash}";

    public void InvalidateSessionHash(string hash) => cache.Remove(SessionCacheKey(hash));

    public void InvalidateSessionHashes(IEnumerable<string> hashes)
    {
        foreach (var hash in hashes) InvalidateSessionHash(hash);
    }

    public async Task RevokeSession(string token, CancellationToken ct)
    {
        var hash = Hash(token);
        await db.Sessions.Where(session => session.Hash == hash).ExecuteDeleteAsync(ct);
        InvalidateSessionHash(hash);
    }

    public async Task<string> CreateSession(Guid user, CancellationToken ct)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        db.Sessions.Add(new Session { UserId = user, Hash = Hash(token), Expires = DateTime.UtcNow.AddDays(30) });
        await db.SaveChangesAsync(ct);
        return token;
    }
}

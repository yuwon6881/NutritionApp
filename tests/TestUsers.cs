using Nutrition.Api.Data;

namespace Nutrition.Tests;

public static class TestUsers
{
    public static async Task<AppUser> CreateAsync(AppDb db, string name = "test-user", string? subject = null, CancellationToken ct = default)
    {
        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            DisplayName = name,
            IdentitySubject = subject ?? $"sub_{Guid.NewGuid():N}"
        };
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        return user;
    }

    public static AppUser Create(string name = "test-user", string? subject = null, Guid? id = null)
    {
        return new AppUser
        {
            Id = id ?? Guid.NewGuid(),
            DisplayName = name,
            IdentitySubject = subject ?? $"sub_{Guid.NewGuid():N}"
        };
    }
}

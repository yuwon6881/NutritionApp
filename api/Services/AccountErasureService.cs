using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services;

/// Validates the Fitness Account's notice that a central account was deleted.
public interface IAccountDeletionNoticeValidator
{
    /// Returns the deleted central subject, or throws a 4xx/503 DomainException.
    Task<string> ValidateAsync(string token, CancellationToken ct);
}

/// Erases everything Nutrition holds for a central account after Fitness Account deletes it.
///
/// Every user-owned table cascades from <see cref="AppUser"/> in the schema, so deleting the user
/// row removes all diary, weight, body, coaching, push, AI and integration rows at once. What the
/// schema cannot reach is handled first: the Google Health grant is revoked at Google, and photo and
/// scan images are deleted from object storage in every stored generation. Storage failures throw,
/// so Fitness Account keeps the notice and retries; the user row stays until storage is clean,
/// because afterwards nothing would remember where the images were.
public sealed class AccountErasureService(
    AppDb db,
    AuthService auth,
    GcsPhotoStore photos,
    TemporaryImageStore scans,
    GoogleHealthService googleHealth)
{
    /// Returns false when no account exists for the subject, which is already the erased state.
    public async Task<bool> EraseAsync(string identitySubject, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.IdentitySubject == identitySubject, ct);
        if (user is null) return false;
        db.CurrentUser = user.Id;
        db.MaintenanceAccess = true;
        // Keep sessions revoked even if an external storage service asks us to retry erasure.
        var sessionHashes = await db.Sessions.Where(session => session.UserId == user.Id).Select(session => session.Hash).ToListAsync(ct);
        await db.Sessions.Where(session => session.UserId == user.Id).ExecuteDeleteAsync(ct);
        auth.InvalidateSessionHashes(sessionHashes);

        await using var gate = await MutationLock.Acquire(db, user.Id, ct);
        if (!await db.Users.AnyAsync(u => u.Id == user.Id, ct)) return false;
        await googleHealth.DisconnectAsync(user.Id, ct);
        await PurgeStoredImages(user.Id, ct);
        await db.Users.Where(u => u.Id == user.Id).ExecuteDeleteAsync(ct);

        await gate.Commit(ct);
        return true;
    }

    private async Task PurgeStoredImages(Guid userId, CancellationToken ct)
    {
        await photos.DeleteAllVersionsUnder(PhotoService.ObjectPrefix(userId), ct);
        await scans.DeleteAllVersionsUnder(ScanService.ObjectPrefix(userId), ct);
    }
}

namespace Nutrition.Api.Services;

/// <summary>Coalesce cache misses without sharing scoped DbContexts or retaining completed work.</summary>
internal static class ReadGate
{
    private sealed class Entry { public readonly SemaphoreSlim Gate = new(1); public int Users; }
    private static readonly Dictionary<string,Entry> Entries = new();
    private static readonly object Sync = new();
    private const int Capacity = 64;

    public static async Task<IDisposable> Enter(string key, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        Entry? entry;
        lock (Sync)
        {
            if (!Entries.TryGetValue(key,out entry))
            {
                if (Entries.Count >= Capacity) return new Lease(null,null);
                Entries[key] = entry = new Entry();
            }
            entry.Users++;
        }
        try { await entry.Gate.WaitAsync(ct); return new Lease(key,entry); }
        catch { Retire(key,entry); throw; }
    }

    private static void Retire(string key, Entry entry)
    {
        lock (Sync)
        {
            if (--entry.Users != 0) return;
            Entries.Remove(key);
            entry.Gate.Dispose();
        }
    }

    private sealed class Lease(string? key, Entry? entry) : IDisposable
    {
        private bool disposed;
        public void Dispose()
        {
            if (disposed || entry is null || key is null) return;
            disposed = true;
            entry.Gate.Release();
            Retire(key,entry);
        }
    }
}

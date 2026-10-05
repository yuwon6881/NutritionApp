/** Apply an identity-based delta to the latest durable work, preserving other tabs' changes. */
export function mergeRetained<T>(latest: readonly T[], before: readonly T[], after: readonly T[], key: (item: T) => string): T[] {
  const old = new Map(before.map(item => [key(item), item]));
  const next = new Map(after.map(item => [key(item), item]));
  const result = new Map(latest.map(item => [key(item), item]));
  for (const [id, previous] of old) {
    const updated = next.get(id);
    const saved = result.get(id);
    // A completed old version cannot delete or replace a newer version saved by another tab.
    if (JSON.stringify(saved) !== JSON.stringify(previous)) continue;
    if (!updated) result.delete(id);
    else if (updated !== previous) result.set(id, updated);
  }
  for (const [id, item] of next) if (!old.has(id)) result.set(id, item);
  return [...result.values()];
}

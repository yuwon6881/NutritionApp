/** Apply an identity-based delta to the latest durable work, preserving other tabs' changes. */
export function mergeRetained<T>(latest: readonly T[], before: readonly T[], after: readonly T[], key: (item: T) => string): T[] {
  const old = new Map(before.map(item => [key(item), item]));
  const next = new Map(after.map(item => [key(item), item]));
  const result = new Map(latest.map(item => [key(item), item]));
  for (const [id, previous] of old) {
    const updated = next.get(id);
    const saved = result.get(id);
    // A completed old version cannot delete or replace a newer version saved by another tab.
    if (!sameJson(saved, previous)) continue;
    if (!updated) result.delete(id);
    else if (updated !== previous) result.set(id, updated);
  }
  for (const [id, item] of next) if (!old.has(id)) result.set(id, item);
  return [...result.values()];
}

/**
 * Equality as JSON would see it (undefined properties are absent), without building the
 * serialized strings: drafts carry multi-megabyte images that a durable copy duplicates.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => sameJson(value ?? null, b[index] ?? null));
  }
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = b as Record<string, unknown>;
  if (left.length !== Object.values(right).filter(value => value !== undefined).length) return false;
  return left.every(([name, value]) => Object.hasOwn(right, name) && sameJson(value, right[name]));
}

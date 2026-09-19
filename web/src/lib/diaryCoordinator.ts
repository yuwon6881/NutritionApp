import type { Day, DatedDiaryDay, DiaryRangeResponse, Entry, Mutation } from '../types';
import { apiWithMeta } from './api';
import { readDatedDiary, saveDatedDiaryBatch, clearUserCache } from './local';

export function getMonthRange(date: string, maxDate: string): { from: string; to: string } {
  const [year, month] = date.split('-').map(Number);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const rawTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const to = rawTo > maxDate ? maxDate : rawTo;
  return { from, to };
}

export class DiaryCoordinator {
  private user: string | null = null;
  private cachedDays = new Map<string, DatedDiaryDay>();
  private rangeEtags = new Map<string, string>();
  private inFlightRanges = new Map<string, Promise<void>>();
  private navigationAbort: AbortController | null = null;
  private listeners = new Set<(date?: string) => void>();

  constructor(user?: string) {
    if (user) this.setUser(user);
  }

  public setUser(newUser: string) {
    if (this.user === newUser) return;
    this.reset();
    this.user = newUser;
  }

  public reset() {
    if (this.navigationAbort) {
      this.navigationAbort.abort();
      this.navigationAbort = null;
    }
    this.cachedDays.clear();
    this.rangeEtags.clear();
    this.inFlightRanges.clear();
    this.user = null;
    this.notify();
  }

  public subscribe(listener: (date?: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(date?: string) {
    for (const listener of this.listeners) {
      try { listener(date); } catch { /* ignore listener error */ }
    }
  }

  public primeDays(days: DatedDiaryDay[]) {
    for (const d of days) {
      const existing = this.cachedDays.get(d.date);
      if (!existing || d.revision >= existing.revision) {
        this.cachedDays.set(d.date, d);
      }
    }
  }

  public getCached(date: string): DatedDiaryDay | undefined {
    return this.cachedDays.get(date);
  }

  public isFresh(date: string, todayDate: string): boolean {
    const cached = this.cachedDays.get(date);
    if (!cached) return false;
    const age = Date.now() - cached.fetchedAt;
    // Today: fresh for 30s; Past dates: fresh for 5 minutes
    const maxAge = date === todayDate ? 30_000 : 300_000;
    return age < maxAge;
  }

  /**
   * Projects active mutations over a dated day.
   * Handles moves immediately on both source and destination dates.
   */
  public projectDate(date: string, queue: Mutation[]): DatedDiaryDay | undefined {
    const base = this.cachedDays.get(date);
    if (!base && !queue.some(q => q.kind === 'entry' && ((q.data as any)?.date === date))) {
      return undefined;
    }

    const entriesMap = new Map<string, Entry>();
    for (const e of base?.entries ?? []) {
      entriesMap.set(e.id, { ...e });
    }

    let day = base?.day ? { ...base.day } : undefined;
    let dayModified = false;

    for (const op of queue) {
      if (op.kind === 'day') {
        const opDate = (op.data as any)?.date;
        if (opDate === date) {
          day = {
            id: op.recordId,
            revision: op.expectedRevision,
            deleted: op.delete,
            date,
            status: (op.data as any)?.status ?? 'incomplete',
            archived: day?.archived
          };
          dayModified = true;
        }
      } else if (op.kind === 'entry') {
        const entryData = op.data as any;
        const targetDate = entryData?.date;
        const originalEntry = entriesMap.get(op.recordId) ?? (base?.entries ?? []).find(e => e.id === op.recordId);
        const originalDate = originalEntry?.date;

        if (originalDate === date && targetDate && targetDate !== date) {
          // Entry moved away from this date
          entriesMap.delete(op.recordId);
          dayModified = true;
        } else if (targetDate === date) {
          // Entry added or moved to this date
          if (op.delete) {
            entriesMap.delete(op.recordId);
          } else {
            entriesMap.set(op.recordId, {
              ...originalEntry,
              ...entryData,
              id: op.recordId,
              revision: op.expectedRevision,
              deleted: false,
              date
            });
          }
          dayModified = true;
        }
      }
    }

    if (dayModified && day && !day.archived) {
      day.status = 'incomplete';
    }

    const entries = [...entriesMap.values()].sort((a, b) =>
      (a.time ?? '').localeCompare(b.time ?? '') || a.id.localeCompare(b.id)
    );

    return {
      date,
      entries,
      day,
      revision: base?.revision ?? 0,
      fetchedAt: base?.fetchedAt ?? Date.now()
    };
  }

  /**
   * Request a date quietly in background or foreground.
   * Deduplicates requests for the same range, cancels obsolete navigation,
   * and drops stale responses.
   */
  public async requestDate(
    date: string,
    todayDate: string,
    options?: { isNavigation?: boolean; force?: boolean }
  ): Promise<void> {
    if (!this.user) return;
    if (!options?.force && this.isFresh(date, todayDate)) {
      return;
    }

    // Determine calendar month range for older history or single range
    const { from, to } = getMonthRange(date, todayDate);
    const rangeKey = `${from}:${to}`;

    if (options?.isNavigation) {
      if (this.navigationAbort) {
        this.navigationAbort.abort();
      }
      this.navigationAbort = new AbortController();
    }

    const existingPromise = this.inFlightRanges.get(rangeKey);
    if (existingPromise) return existingPromise;

    const signal = options?.isNavigation ? this.navigationAbort?.signal : undefined;
    const requestPromise = (async () => {
      try {
        const etag = this.rangeEtags.get(rangeKey);
        const headers: Record<string, string> = {};
        if (etag) headers['If-None-Match'] = etag;

        const res = await apiWithMeta<DiaryRangeResponse>(
          `/diary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { headers, signal }
        );

        if (signal?.aborted) return;

        if (res.notModified) {
          // 304: update fetchedAt timestamp
          const now = Date.now();
          const updated: DatedDiaryDay[] = [];
          for (const [d, cached] of this.cachedDays.entries()) {
            if (d >= from && d <= to) {
              cached.fetchedAt = now;
              updated.push(cached);
            }
          }
          if (this.user && updated.length) {
            await saveDatedDiaryBatch(this.user, updated).catch(() => {});
          }
          this.notify(date);
          return;
        }

        if (res.data) {
          const { entries, days, revision } = res.data;
          if (res.etag) this.rangeEtags.set(rangeKey, res.etag);

          const now = Date.now();
          const datesInResponse = new Map<string, { entries: Entry[]; day?: Day }>();

          // Collect returned entries and days
          for (const e of entries) {
            let bucket = datesInResponse.get(e.date);
            if (!bucket) {
              bucket = { entries: [] };
              datesInResponse.set(e.date, bucket);
            }
            bucket.entries.push(e);
          }
          for (const d of days) {
            let bucket = datesInResponse.get(d.date);
            if (!bucket) {
              bucket = { entries: [] };
              datesInResponse.set(d.date, bucket);
            }
            bucket.day = d;
          }

          // Also ensure requested date has an empty bucket if no entries/days
          if (!datesInResponse.has(date)) {
            datesInResponse.set(date, { entries: [] });
          }

          const toSave: DatedDiaryDay[] = [];
          for (const [dStr, bucket] of datesInResponse.entries()) {
            const existing = this.cachedDays.get(dStr);
            // Drop older response if newer cached data exists
            if (existing && revision < existing.revision) continue;

            const dayRecord: DatedDiaryDay = {
              date: dStr,
              entries: bucket.entries.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.id.localeCompare(b.id)),
              day: bucket.day,
              revision,
              fetchedAt: now
            };
            this.cachedDays.set(dStr, dayRecord);
            toSave.push(dayRecord);
          }

          if (this.user && toSave.length) {
            await saveDatedDiaryBatch(this.user, toSave).catch(() => {});
          }
          this.notify(date);
        }
      } catch (ex: any) {
        if (ex?.name === 'AbortError') return;
        throw ex;
      } finally {
        this.inFlightRanges.delete(rangeKey);
      }
    })();

    this.inFlightRanges.set(rangeKey, requestPromise);
    return requestPromise;
  }
}

export const sharedDiaryCoordinator = new DiaryCoordinator();

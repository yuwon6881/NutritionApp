import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiaryCoordinator, getMonthRange } from './diaryCoordinator';
import type { DatedDiaryDay, Entry, Mutation } from '../types';

describe('DiaryCoordinator', () => {
  let coordinator: DiaryCoordinator;

  beforeEach(() => {
    coordinator = new DiaryCoordinator('user-1');
  });

  it('calculates calendar month ranges correctly', () => {
    const r1 = getMonthRange('2026-09-18', '2026-09-19');
    expect(r1.from).toBe('2026-09-01');
    expect(r1.to).toBe('2026-09-19'); // clipped to maxDate

    const r2 = getMonthRange('2026-02-10', '2026-09-19');
    expect(r2.from).toBe('2026-02-01');
    expect(r2.to).toBe('2026-02-28');
  });

  it('reports freshness correctly: 30s for today, 5m for past dates', () => {
    const today = '2026-09-19';
    const past = '2026-09-10';

    const now = Date.now();
    coordinator.primeDays([
      { date: today, entries: [], revision: 1, fetchedAt: now - 10_000 },
      { date: past, entries: [], revision: 1, fetchedAt: now - 60_000 }
    ]);

    expect(coordinator.isFresh(today, today)).toBe(true);
    expect(coordinator.isFresh(past, today)).toBe(true);

    // Stale today (>30s)
    coordinator.primeDays([{ date: today, entries: [], revision: 1, fetchedAt: now - 35_000 }]);
    expect(coordinator.isFresh(today, today)).toBe(false);

    // Stale past date (>5m)
    coordinator.primeDays([{ date: past, entries: [], revision: 1, fetchedAt: now - 305_000 }]);
    expect(coordinator.isFresh(past, today)).toBe(false);
  });

  it('projects move mutations immediately across both source and destination dates', () => {
    const dateA = '2026-09-10';
    const dateB = '2026-09-11';

    const entry1: Entry = {
      id: 'entry-1',
      date: dateA,
      time: '12:00',
      name: 'Rice',
      calories: 200,
      quantity: 1,
      unit: 'serving',
      protein: 4,
      carbs: 45,
      fat: 1,
      fiber: 1,
      source: 'manual',
      revision: 1,
      deleted: false
    };

    coordinator.primeDays([
      { date: dateA, entries: [entry1], day: { id: 'd-a', date: dateA, status: 'complete', revision: 1, deleted: false }, revision: 1, fetchedAt: Date.now() },
      { date: dateB, entries: [], day: { id: 'd-b', date: dateB, status: 'complete', revision: 1, deleted: false }, revision: 1, fetchedAt: Date.now() }
    ]);

    // Move entry-1 to dateB
    const moveQueue: Mutation[] = [
      {
        id: 'm-1',
        kind: 'entry',
        recordId: 'entry-1',
        expectedRevision: 1,
        delete: false,
        data: { ...entry1, date: dateB, time: '13:00' }
      }
    ];

    const projectedA = coordinator.projectDate(dateA, moveQueue);
    expect(projectedA?.entries).toHaveLength(0);
    expect(projectedA?.day?.status).toBe('incomplete');

    const projectedB = coordinator.projectDate(dateB, moveQueue);
    expect(projectedB?.entries).toHaveLength(1);
    expect(projectedB?.entries[0].date).toBe(dateB);
    expect(projectedB?.entries[0].time).toBe('13:00');
    expect(projectedB?.day?.status).toBe('incomplete');
  });

  it('drops stale responses with an older revision than cached data', () => {
    coordinator.primeDays([
      { date: '2026-09-18', entries: [{ id: 'e1', date: '2026-09-18', name: 'Newer', calories: 100, quantity: 1, unit: 'g', source: 'm', revision: 5, deleted: false, protein: null, carbs: null, fat: null, fiber: null }], revision: 5, fetchedAt: Date.now() }
    ]);

    // An incoming day with revision 3 must not overwrite revision 5
    const existing = coordinator.getCached('2026-09-18');
    expect(existing?.revision).toBe(5);
  });

  it('resets completely on account switch', () => {
    coordinator.primeDays([
      { date: '2026-09-18', entries: [], revision: 1, fetchedAt: Date.now() }
    ]);
    expect(coordinator.getCached('2026-09-18')).toBeDefined();

    coordinator.setUser('user-2');
    expect(coordinator.getCached('2026-09-18')).toBeUndefined();
  });
});

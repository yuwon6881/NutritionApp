import { expect, it } from 'vitest';
import { clipHistory, historyState } from './history';
import type { AppState } from '../types';

const state = { id: 'a', revision: 1, profile: { timeZone: 'UTC' }, start: '2026-01-01', end: '2026-03-31',
  entries: [{ id: 'e', date: '2026-03-01', calories: 100 }], days: [{ id: 'd', date: '2026-03-01', status: 'complete' }],
  weights: [{ id: 'before', date: '2026-01-03', kg: 80 }, { id: 'boundary', date: '2026-01-04', kg: 81 },
    { id: 'deleted', date: '2026-02-01', kg: 90, deleted: true }, { id: 'current', date: '2026-03-01', kg: 82 }],
  weightTrendSeed: [{ date: '2026-01-04', kg: 70 }], foods: [], plans: [] } as unknown as AppState;

it('retains the exact inclusive diary range and 56-day seed boundary without mutating source data', () => {
  const clipped = clipHistory(state, '2026-03-01', '2026-03-01');
  expect(clipped.entries).toEqual(state.entries);
  expect(clipped.days).toEqual(state.days);
  expect(clipped.weights).toEqual([state.weights[3]]);
  expect(clipped.weightTrendSeed).toEqual([state.weights[1]]);
  expect(state.weightTrendSeed).toEqual([{ date: '2026-01-04', kg: 70 }]);
});
it('projects pending diary edits in the fallback and rejects another account’s history', () => {
  const local = { state, queue: [{ id: 'm', kind: 'entry' as const, recordId: 'e', expectedRevision: 1, delete: false,
    data: { ...state.entries[0], calories: 150 } }], history: { '2026-03-01': { ...state, id: 'b', revision: 99 } } };
  expect(historyState(local, '2026-03-01')?.entries[0].calories).toBe(150);
  expect(historyState(local, '2025-03-01')).toBeUndefined();
});

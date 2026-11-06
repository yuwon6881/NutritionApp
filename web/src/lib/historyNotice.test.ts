import {describe,it,expect} from 'vitest';
import {isSyncStatusActive} from '../components/ui/SyncStatus';
import type {NutritionStore} from '../useNutritionStore';

function createMockStore(overrides: Partial<NutritionStore> = {}): NutritionStore {
  return {
    state: null,
    local: {
      state: {
        id: 'u1',
        username: 'test',
        revision: 1,
        profileRevision: 1,
        profile: null,
        start: '2026-01-01',
        end: '2026-12-31',
        entries: [],
        foods: [],
        weights: [],
        days: [],
        plans: []
      },
      queue: [],
      photoDrafts: [],
      bodyDrafts: []
    },
    sync: {
      phase: 'idle'
    },
    isActivityActive: false,
    calendarDate: '2026-11-06',
    error: '',
    busy: false,
    ...overrides
  } as unknown as NutritionStore;
}

describe('isSyncStatusActive', () => {
  it('returns false when store is undefined or null', () => {
    expect(isSyncStatusActive(null)).toBe(false);
    expect(isSyncStatusActive(undefined)).toBe(false);
  });

  it('returns false when online and no pending offline sync', () => {
    const store = createMockStore();
    expect(isSyncStatusActive(store)).toBe(false);
  });

  it('returns true when sync is actively uploading a photo or body draft', () => {
    const photoStore = createMockStore({
      sync: {phase: 'syncing', kind: 'photo'} as any
    });
    expect(isSyncStatusActive(photoStore)).toBe(true);

    const bodyStore = createMockStore({
      sync: {phase: 'syncing', kind: 'body'} as any
    });
    expect(isSyncStatusActive(bodyStore)).toBe(true);
  });
});

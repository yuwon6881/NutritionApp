import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as apiModule from './api';
import {
  calculateKnownDayAverage,
  connectGoogleHealth,
  disconnectGoogleHealth,
  getTodayStepCount,
  initialGoogleHealthState,
  recoverGoogleHealthBundledSync,
  resetGoogleHealthState,
  setGoogleHealthBundledSync,
  shouldShowDashboardSteps,
  syncGoogleHealth,
  GoogleHealthSyncState,
} from './googleHealth';

describe('calculateKnownDayAverage', () => {
  it('returns null for empty array', () => {
    expect(calculateKnownDayAverage([])).toBeNull();
  });

  it('returns null when all day counts are null', () => {
    const days = [
      { date: '2026-09-01', count: null },
      { date: '2026-09-02', count: null },
    ];
    expect(calculateKnownDayAverage(days)).toBeNull();
  });

  it('calculates rounded average ignoring null days', () => {
    const days = [
      { date: '2026-09-01', count: 5000 },
      { date: '2026-09-02', count: null },
      { date: '2026-09-03', count: 6001 },
    ];
    // (5000 + 6001) / 2 = 5500.5 -> 5501
    expect(calculateKnownDayAverage(days)).toBe(5501);
  });

  it('includes zero step counts in the average calculation', () => {
    const days = [
      { date: '2026-09-01', count: 0 },
      { date: '2026-09-02', count: 10000 },
    ];
    expect(calculateKnownDayAverage(days)).toBe(5000);
  });

  it('excludes specified date (such as today) from the average calculation', () => {
    const days = [
      { date: '2026-09-01', count: 5000 },
      { date: '2026-09-02', count: 1000 },
    ];
    expect(calculateKnownDayAverage(days, '2026-09-02')).toBe(5000);
  });
});

describe('getTodayStepCount', () => {
  it('returns count when today date is found with steps', () => {
    const days = [
      { date: '2026-09-13', count: 8500 },
      { date: '2026-09-14', count: 9200 },
    ];
    expect(getTodayStepCount(days, '2026-09-14')).toBe(9200);
  });

  it('returns null when today date is found with null count', () => {
    const days = [
      { date: '2026-09-14', count: null },
    ];
    expect(getTodayStepCount(days, '2026-09-14')).toBeNull();
  });

  it('returns null when today date is not in days list', () => {
    const days = [
      { date: '2026-09-13', count: 8500 },
    ];
    expect(getTodayStepCount(days, '2026-09-14')).toBeNull();
  });
});

describe('googleHealth sync manager', () => {
  let apiSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetGoogleHealthState();
    apiSpy = vi.spyOn(apiModule, 'api');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetGoogleHealthState();
  });

  it('connectGoogleHealth calls connect endpoint with bundled write sync by default', async () => {
    apiSpy.mockResolvedValueOnce({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?test=1' });
    const result = await connectGoogleHealth();
    expect(apiSpy).toHaveBeenCalledWith('/integrations/google-health/connect', {
      syncWeight: true,
      syncNutrition: true,
      syncBodyFat: true,
    });
    expect(result.authUrl).toContain('accounts.google.com');
  });

  it('connectGoogleHealth calls connect endpoint with empty payload when disabled', async () => {
    apiSpy.mockResolvedValueOnce({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?test=1' });
    await connectGoogleHealth(false);
    expect(apiSpy).toHaveBeenCalledWith('/integrations/google-health/connect', {});
  });

  it('setGoogleHealthBundledSync updates all three sync preferences', async () => {
    const updatedItem = {
      enabled: true,
      permissionGranted: true,
      state: 'idle' as const,
      pendingCount: 0,
      lastSuccessfulSyncAt: null,
      revision: 1,
    };
    apiSpy.mockResolvedValue(updatedItem);
    await setGoogleHealthBundledSync(true);
    expect(apiSpy).toHaveBeenCalledWith('/integrations/google-health/weight-sync/preference', {enabled: true, revision: 0});
    expect(apiSpy).toHaveBeenCalledWith('/integrations/google-health/nutrition-sync/preference', {enabled: true, revision: 0});
    expect(apiSpy).toHaveBeenCalledWith('/integrations/google-health/body-fat-sync/preference', {enabled: true, revision: 0});
  });

  it('recoverGoogleHealthBundledSync recovers failed or unknown streams', async () => {
    const mockSync: GoogleHealthSyncState = {
      status: 'connected',
      connectedAt: '2026-09-14T08:00:00Z',
      lastSyncedAt: '2026-09-14T08:00:00Z',
      freshness: 'fresh',
      days: [],
      weightSync: {...initialGoogleHealthState.weightSync, state: 'failed'},
      nutritionSync: {...initialGoogleHealthState.nutritionSync, state: 'unknown'},
      bodyFatSync: {...initialGoogleHealthState.bodyFatSync, state: 'idle'},
    };
    apiSpy.mockResolvedValueOnce(mockSync);
    await syncGoogleHealth();

    apiSpy.mockResolvedValue(initialGoogleHealthState.weightSync);
    await recoverGoogleHealthBundledSync();
    expect(apiSpy).toHaveBeenCalledWith('/integrations/google-health/weight-sync/recover', {weightId: null});
    expect(apiSpy).toHaveBeenCalledWith('/integrations/google-health/nutrition-sync/recover', {entryId: null});
    expect(apiSpy).not.toHaveBeenCalledWith('/integrations/google-health/body-fat-sync/recover', expect.anything());
  });

  it('syncGoogleHealth calls sync endpoint and updates memory state', async () => {
    const mockSync: GoogleHealthSyncState = {
      status: 'connected',
      connectedAt: '2026-09-14T08:00:00Z',
      lastSyncedAt: '2026-09-14T08:00:00Z',
      freshness: 'fresh',
      days: [
        { date: '2026-09-14', count: 7500 },
      ],
      weightSync: initialGoogleHealthState.weightSync,
      nutritionSync: initialGoogleHealthState.nutritionSync,
      bodyFatSync: initialGoogleHealthState.bodyFatSync,
    };
    apiSpy.mockResolvedValueOnce(mockSync);

    const state = await syncGoogleHealth();
    expect(apiSpy).toHaveBeenCalledWith('/integrations/google-health/sync', {force: false});
    expect(state.status).toBe('connected');
    expect(state.freshness).toBe('fresh');
    expect(state.days).toHaveLength(1);
    expect(state.days[0].count).toBe(7500);
  });

  it('coalesces concurrent sync requests to a single in-flight call', async () => {
    const mockSync: GoogleHealthSyncState = {
      status: 'connected',
      connectedAt: '2026-09-14T08:00:00Z',
      lastSyncedAt: '2026-09-14T08:00:00Z',
      freshness: 'fresh',
      days: [],
      weightSync: initialGoogleHealthState.weightSync,
      nutritionSync: initialGoogleHealthState.nutritionSync,
      bodyFatSync: initialGoogleHealthState.bodyFatSync,
    };
    let resolveApi: (value: GoogleHealthSyncState) => void;
    const slowPromise = new Promise<GoogleHealthSyncState>((res) => {
      resolveApi = res;
    });
    apiSpy.mockReturnValueOnce(slowPromise);

    const call1 = syncGoogleHealth();
    const call2 = syncGoogleHealth();

    resolveApi!(mockSync);
    const [res1, res2] = await Promise.all([call1, call2]);

    expect(apiSpy).toHaveBeenCalledTimes(1);
    expect(res1).toBe(res2);
  });

  it('skips sync within 2 minutes unless forced', async () => {
    const mockSync: GoogleHealthSyncState = {
      status: 'connected',
      connectedAt: '2026-09-14T08:00:00Z',
      lastSyncedAt: '2026-09-14T08:00:00Z',
      freshness: 'fresh',
      days: [{ date: '2026-09-14', count: 5000 }],
      weightSync: initialGoogleHealthState.weightSync,
      nutritionSync: initialGoogleHealthState.nutritionSync,
      bodyFatSync: initialGoogleHealthState.bodyFatSync,
    };
    apiSpy.mockResolvedValue(mockSync);

    await syncGoogleHealth();
    expect(apiSpy).toHaveBeenCalledTimes(1);

    // Call again within 2 minutes without force
    const cached = await syncGoogleHealth(false);
    expect(apiSpy).toHaveBeenCalledTimes(1);
    expect(cached.days[0].count).toBe(5000);

    // Call again with force = true
    await syncGoogleHealth(true);
    expect(apiSpy).toHaveBeenCalledTimes(2);
  });

  it('transitions to stale state on sync failure when previously connected', async () => {
    const connectedState: GoogleHealthSyncState = {
      status: 'connected',
      connectedAt: '2026-09-14T08:00:00Z',
      lastSyncedAt: '2026-09-14T08:00:00Z',
      freshness: 'fresh',
      days: [{ date: '2026-09-14', count: 3000 }],
      weightSync: initialGoogleHealthState.weightSync,
      nutritionSync: initialGoogleHealthState.nutritionSync,
      bodyFatSync: initialGoogleHealthState.bodyFatSync,
    };
    apiSpy.mockResolvedValueOnce(connectedState);
    await syncGoogleHealth();

    // Now fail subsequent forced sync
    apiSpy.mockRejectedValueOnce(new Error('Network error'));
    const staleState = await syncGoogleHealth(true);

    expect(staleState.status).toBe('connected');
    expect(staleState.freshness).toBe('stale');
    expect(staleState.warningCode).toBe('sync_failed');
    expect(staleState.days[0].count).toBe(3000);
  });

  it('disconnectGoogleHealth calls disconnect endpoint and resets to disconnected', async () => {
    apiSpy.mockResolvedValueOnce(initialGoogleHealthState);
    const state = await disconnectGoogleHealth();
    expect(apiSpy).toHaveBeenCalledWith('/integrations/google-health/disconnect', {});
    expect(state.status).toBe('disconnected');
    expect(state.freshness).toBe('unavailable');
  });
});

describe('dashboard step visibility', () => {
  it('shows only connected Google Health accounts, while keeping known connections visible during refresh', () => {
    expect(shouldShowDashboardSteps({status: 'disconnected', connectedAt: null}, false)).toBe(false);
    expect(shouldShowDashboardSteps({status: 'connected', connectedAt: null}, true)).toBe(false);
    expect(shouldShowDashboardSteps({status: 'connected', connectedAt: '2026-09-18T00:00:00Z'}, true)).toBe(true);
    expect(shouldShowDashboardSteps({status: 'reconnect_required', connectedAt: '2026-09-18T00:00:00Z'}, false)).toBe(false);
  });
});

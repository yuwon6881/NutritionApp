import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {api} from './api';

export type GoogleHealthStatus = 'disconnected' | 'connected' | 'reconnect_required';
export type GoogleHealthFreshness = 'fresh' | 'stale' | 'unavailable';
export type GoogleHealthWeightSyncState = 'disabled' | 'idle' | 'pending' | 'failed' | 'unknown' | 'reconnect_required';

export interface GoogleHealthWeightSyncStatus {
  enabled: boolean;
  permissionGranted: boolean;
  state: GoogleHealthWeightSyncState;
  pendingCount: number;
  lastSuccessfulSyncAt: string | null;
  revision: number;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export interface GoogleHealthDay {
  date: string;
  count: number | null;
}

export interface GoogleHealthSyncState {
  status: GoogleHealthStatus;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  freshness: GoogleHealthFreshness;
  days: GoogleHealthDay[];
  warningCode?: string | null;
  warningMessage?: string | null;
  weightSync: GoogleHealthWeightSyncStatus;
}

export const initialGoogleHealthState: GoogleHealthSyncState = {
  status: 'disconnected',
  connectedAt: null,
  lastSyncedAt: null,
  freshness: 'unavailable',
  days: [],
  weightSync: {
    enabled: false,
    permissionGranted: false,
    state: 'disabled',
    pendingCount: 0,
    lastSuccessfulSyncAt: null,
    revision: 0,
  },
};

// Google-derived data remains in runtime memory ONLY. Never persist to IndexedDB/localStorage.
let memoryState: GoogleHealthSyncState = initialGoogleHealthState;
let lastFetchTime = 0;
let inFlightPromise: Promise<GoogleHealthSyncState> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): GoogleHealthSyncState {
  return memoryState;
}

export async function connectGoogleHealth(syncWeight = false): Promise<{ authUrl: string }> {
  return await api<{ authUrl: string }>('/integrations/google-health/connect', syncWeight ? {syncWeight: true} : {});
}

export async function setGoogleHealthWeightSync(enabled: boolean, revision: number): Promise<GoogleHealthWeightSyncStatus> {
  const result = await api<GoogleHealthWeightSyncStatus>('/integrations/google-health/weight-sync/preference', {enabled, revision});
  memoryState = {...memoryState, weightSync: result};
  notify();
  return result;
}

export async function recoverGoogleHealthWeightSync(weightId?: string): Promise<GoogleHealthWeightSyncStatus> {
  const result = await api<GoogleHealthWeightSyncStatus>('/integrations/google-health/weight-sync/recover', {weightId: weightId ?? null});
  memoryState = {...memoryState, weightSync: result};
  notify();
  return result;
}

export async function disconnectGoogleHealth(): Promise<GoogleHealthSyncState> {
  const result = await api<GoogleHealthSyncState>('/integrations/google-health/disconnect', {});
  const nextState = {...result, weightSync: result.weightSync ?? initialGoogleHealthState.weightSync};
  memoryState = nextState;
  lastFetchTime = Date.now();
  notify();
  return nextState;
}

export async function syncGoogleHealth(force = false): Promise<GoogleHealthSyncState> {
  if (inFlightPromise) {
    return inFlightPromise;
  }

  const now = Date.now();
  if (!force && memoryState.status !== 'disconnected' && memoryState.freshness === 'fresh' && now - lastFetchTime < 2 * 60 * 1000) {
    return memoryState;
  }

  inFlightPromise = (async () => {
    try {
      const result = await api<GoogleHealthSyncState>('/integrations/google-health/sync', {});
      memoryState = {...result, weightSync: result.weightSync ?? initialGoogleHealthState.weightSync};
      lastFetchTime = Date.now();
      notify();
      return result;
    } catch (err) {
      if (memoryState.status === 'connected') {
        memoryState = {
          ...memoryState,
          freshness: 'stale',
          warningCode: 'sync_failed',
          warningMessage: 'Could not connect to Google Health. Showing saved steps.',
        };
        notify();
        return memoryState;
      }
      throw err;
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

export function resetGoogleHealthState() {
  memoryState = initialGoogleHealthState;
  lastFetchTime = 0;
  inFlightPromise = null;
  notify();
}

/**
 * Calculates the average of days with known step counts.
 * Missing dates (null) are excluded from the average.
 * If there are zero known days, returns null.
 */
export function calculateKnownDayAverage(days: GoogleHealthDay[]): number | null {
  const known = days.filter((d): d is GoogleHealthDay & { count: number } => d.count !== null && d.count !== undefined);
  if (known.length === 0) return null;
  const total = known.reduce((acc, d) => acc + d.count, 0);
  return Math.round(total / known.length);
}

export function getTodayStepCount(days: GoogleHealthDay[], todayDate: string): number | null {
  const item = days.find(d => d.date === todayDate);
  return item?.count ?? null;
}

export function shouldShowDashboardSteps(state: Pick<GoogleHealthSyncState, 'status' | 'connectedAt'>, loading: boolean): boolean {
  return state.status !== 'disconnected' && (!loading || state.connectedAt !== null);
}

export function useGoogleHealth(enabled = true) {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => initialGoogleHealthState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      await syncGoogleHealth(force);
    } catch (ex) {
      setError((ex as Error).message || 'Failed to sync Google Health');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    // Refresh on launch
    void refresh();

    // Refresh on browser online
    const handleOnline = () => {
      void refresh(true);
    };

    // Refresh on foreground resume
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh(false);
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, refresh]);

  return {
    state,
    loading,
    error,
    refresh,
    connect: connectGoogleHealth,
    disconnect: disconnectGoogleHealth,
  };
}

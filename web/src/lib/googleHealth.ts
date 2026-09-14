import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {api} from './api';

export type GoogleHealthStatus = 'disconnected' | 'connected' | 'reconnect_required';
export type GoogleHealthFreshness = 'fresh' | 'stale' | 'unavailable';

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
}

export const initialGoogleHealthState: GoogleHealthSyncState = {
  status: 'disconnected',
  connectedAt: null,
  lastSyncedAt: null,
  freshness: 'unavailable',
  days: [],
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

export async function connectGoogleHealth(): Promise<{ authUrl: string }> {
  return await api<{ authUrl: string }>('/integrations/google-health/connect', {});
}

export async function disconnectGoogleHealth(): Promise<GoogleHealthSyncState> {
  const result = await api<GoogleHealthSyncState>('/integrations/google-health/disconnect', {});
  memoryState = result;
  lastFetchTime = Date.now();
  notify();
  return result;
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
      memoryState = result;
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

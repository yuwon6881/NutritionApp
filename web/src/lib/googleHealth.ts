import { resetIntegrationDispatch } from './integrationDispatch';
import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {api, ApiError} from './api';
import {consumeGoogleHealthHandoff} from './googleHealthBrowser';
import {IntegrationRecovery} from './integrationRecovery';

export type GoogleHealthStatus = 'disconnected' | 'connected' | 'reconnect_required';
export type GoogleHealthFreshness = 'fresh' | 'stale' | 'unavailable';
export type GoogleHealthSyncItemState = 'disabled' | 'idle' | 'pending' | 'failed' | 'unknown' | 'reconnect_required';

export interface GoogleHealthItemSyncStatus {
  enabled: boolean;
  permissionGranted: boolean;
  state: GoogleHealthSyncItemState;
  pendingCount: number;
  lastSuccessfulSyncAt: string | null;
  revision: number;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export type GoogleHealthWeightSyncStatus = GoogleHealthItemSyncStatus;
export type GoogleHealthNutritionSyncStatus = GoogleHealthItemSyncStatus;
export type GoogleHealthBodyFatSyncStatus = GoogleHealthItemSyncStatus;

export type GoogleHealthWeightImportState = 'disabled' | 'idle' | 'failed' | 'reconnect_required';

export interface GoogleHealthWeightImportStatus {
  enabled: boolean;
  permissionGranted: boolean;
  state: GoogleHealthWeightImportState;
  lastSuccessAt: string | null;
  lastImportedCount: number;
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
  nutritionSync: GoogleHealthNutritionSyncStatus;
  bodyFatSync: GoogleHealthBodyFatSyncStatus;
  weightImport: GoogleHealthWeightImportStatus;
}

const initialItemStatus: GoogleHealthItemSyncStatus = {
  enabled: false,
  permissionGranted: false,
  state: 'disabled',
  pendingCount: 0,
  lastSuccessfulSyncAt: null,
  revision: 0,
};

const initialImportStatus: GoogleHealthWeightImportStatus = {
  enabled: false,
  permissionGranted: false,
  state: 'disabled',
  lastSuccessAt: null,
  lastImportedCount: 0,
  revision: 0,
};

export const initialGoogleHealthState: GoogleHealthSyncState = {
  status: 'disconnected',
  connectedAt: null,
  lastSyncedAt: null,
  freshness: 'unavailable',
  days: [],
  weightSync: initialItemStatus,
  nutritionSync: initialItemStatus,
  bodyFatSync: initialItemStatus,
  weightImport: initialImportStatus,
};

// Google-derived data remains in runtime memory ONLY. Never persist to IndexedDB/localStorage.
let memoryState: GoogleHealthSyncState = initialGoogleHealthState;
let lastFetchTime = 0;
let inFlightPromise: Promise<GoogleHealthSyncState> | null = null;
let inFlightForced = false;
let generation = 0;
let dataSyncFlight: Promise<void> | null = null;
let dataSyncAgain = false;
let dataSyncTimer: ReturnType<typeof setTimeout> | undefined;
let lastDataSync = 0;
const recovery = new IntegrationRecovery();
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

export interface ConnectOptions {
  syncWeight?: boolean;
  syncNutrition?: boolean;
  syncBodyFat?: boolean;
  importWeight?: boolean;
}

export async function connectGoogleHealth(optionsOrWeight: boolean | ConnectOptions = true): Promise<{ authUrl: string }> {
  const payload: Record<string, boolean> = {};
  if (typeof optionsOrWeight === 'boolean') {
    if (optionsOrWeight) {
      payload.syncWeight = true;
      payload.syncNutrition = true;
      payload.syncBodyFat = true;
    }
  } else {
    if (optionsOrWeight.syncWeight) payload.syncWeight = true;
    if (optionsOrWeight.syncNutrition) payload.syncNutrition = true;
    if (optionsOrWeight.syncBodyFat) payload.syncBodyFat = true;
    if (optionsOrWeight.importWeight) payload.importWeight = true;
  }
  return await api<{ authUrl: string }>('/integrations/google-health/connect', payload);
}

export async function setGoogleHealthWeightSync(enabled: boolean, revision: number): Promise<GoogleHealthWeightSyncStatus> {
  const result = await api<GoogleHealthWeightSyncStatus>('/integrations/google-health/weight-sync/preference', {enabled, revision});
  memoryState = {...memoryState, weightSync: result};
  notify();
  return result;
}

// Turning import off only stops future imports; weigh-ins already imported stay.
export async function setGoogleHealthWeightImport(enabled: boolean, revision: number): Promise<GoogleHealthWeightImportStatus> {
  const result = await api<GoogleHealthWeightImportStatus>('/integrations/google-health/weight-import/preference', {enabled, revision});
  memoryState = {...memoryState, weightImport: result};
  notify();
  return result;
}

export async function recoverGoogleHealthWeightSync(weightId?: string): Promise<GoogleHealthWeightSyncStatus> {
  const result = await api<GoogleHealthWeightSyncStatus>('/integrations/google-health/weight-sync/recover', {weightId: weightId ?? null});
  memoryState = {...memoryState, weightSync: result};
  notify();
  return result;
}

export async function setGoogleHealthNutritionSync(enabled: boolean, revision: number): Promise<GoogleHealthNutritionSyncStatus> {
  const result = await api<GoogleHealthNutritionSyncStatus>('/integrations/google-health/nutrition-sync/preference', {enabled, revision});
  memoryState = {...memoryState, nutritionSync: result};
  notify();
  return result;
}

export async function recoverGoogleHealthNutritionSync(entryId?: string): Promise<GoogleHealthNutritionSyncStatus> {
  const result = await api<GoogleHealthNutritionSyncStatus>('/integrations/google-health/nutrition-sync/recover', {entryId: entryId ?? null});
  memoryState = {...memoryState, nutritionSync: result};
  notify();
  return result;
}

export async function setGoogleHealthBodyFatSync(enabled: boolean, revision: number): Promise<GoogleHealthBodyFatSyncStatus> {
  const result = await api<GoogleHealthBodyFatSyncStatus>('/integrations/google-health/body-fat-sync/preference', {enabled, revision});
  memoryState = {...memoryState, bodyFatSync: result};
  notify();
  return result;
}

export async function recoverGoogleHealthBodyFatSync(bodyRecordId?: string): Promise<GoogleHealthBodyFatSyncStatus> {
  const result = await api<GoogleHealthBodyFatSyncStatus>('/integrations/google-health/body-fat-sync/recover', {bodyRecordId: bodyRecordId ?? null});
  memoryState = {...memoryState, bodyFatSync: result};
  notify();
  return result;
}

export async function setGoogleHealthBundledSync(enabled: boolean): Promise<void> {
  const current = getSnapshot();
  const [weight, nutrition, bodyFat] = await Promise.all([
    setGoogleHealthWeightSync(enabled, current.weightSync.revision),
    setGoogleHealthNutritionSync(enabled, current.nutritionSync.revision),
    setGoogleHealthBodyFatSync(enabled, current.bodyFatSync.revision),
  ]);
  memoryState = {
    ...memoryState,
    weightSync: weight,
    nutritionSync: nutrition,
    bodyFatSync: bodyFat,
  };
  notify();
}

export async function recoverGoogleHealthBundledSync(): Promise<void> {
  const current = getSnapshot();
  const promises: Promise<unknown>[] = [];
  if (current.weightSync.state === 'failed' || current.weightSync.state === 'unknown') {
    promises.push(recoverGoogleHealthWeightSync());
  }
  if (current.nutritionSync.state === 'failed' || current.nutritionSync.state === 'unknown') {
    promises.push(recoverGoogleHealthNutritionSync());
  }
  if (current.bodyFatSync.state === 'failed' || current.bodyFatSync.state === 'unknown') {
    promises.push(recoverGoogleHealthBodyFatSync());
  }
  await Promise.all(promises);
}

export async function disconnectGoogleHealth(): Promise<GoogleHealthSyncState> {
  const result = await api<GoogleHealthSyncState>('/integrations/google-health/disconnect', {});
  resetGoogleHealthState();
  const nextState: GoogleHealthSyncState = {
    ...result,
    weightSync: result.weightSync ?? initialGoogleHealthState.weightSync,
    nutritionSync: result.nutritionSync ?? initialGoogleHealthState.nutritionSync,
    bodyFatSync: result.bodyFatSync ?? initialGoogleHealthState.bodyFatSync,
    weightImport: result.weightImport ?? initialGoogleHealthState.weightImport,
  };
  memoryState = nextState;
  lastFetchTime = Date.now();
  notify();
  return nextState;
}

export async function syncGoogleHealth(force = false): Promise<GoogleHealthSyncState> {
  if (inFlightPromise) {
    if (force && !inFlightForced) return inFlightPromise.then(() => syncGoogleHealth(true));
    return inFlightPromise;
  }

  const now = Date.now();
  if (!force && memoryState.status !== 'disconnected' && memoryState.freshness === 'fresh' && now - lastFetchTime < 2 * 60 * 1000) {
    return memoryState;
  }

  const epoch = generation;
  inFlightForced = force;
  inFlightPromise = (async () => {
    try {
      const result = await api<GoogleHealthSyncState>('/integrations/google-health/sync', {force, cacheOnly: !force});
      if (epoch !== generation) throw new DOMException('Account changed', 'AbortError');
      memoryState = {
        ...result,
        weightSync: result.weightSync ?? initialGoogleHealthState.weightSync,
        nutritionSync: result.nutritionSync ?? initialGoogleHealthState.nutritionSync,
        bodyFatSync: result.bodyFatSync ?? initialGoogleHealthState.bodyFatSync,
        weightImport: result.weightImport ?? initialGoogleHealthState.weightImport,
      };
      lastFetchTime = Date.now();
      notify();
      if (memoryState.freshness === 'fresh') recovery.reset();
      else if (memoryState.status === 'connected' && listeners.size && ((!force && !memoryState.warningCode) ||
        ['sync_timeout','cache_unavailable','kms_error','refresh_error','sync_network_error','provider_unavailable'].includes(memoryState.warningCode ?? ''))) {
        recovery.schedule(() => syncGoogleHealth(true), force ? 5000 : 0);
      }
      scheduleDataSync(force);
      return memoryState;
    } catch (err) {
      if (epoch !== generation) throw err;
      if (memoryState.status === 'connected') {
        memoryState = {
          ...memoryState,
          freshness: 'stale',
          warningCode: 'sync_failed',
          warningMessage: err instanceof ApiError && err.status === 429
            ? 'The service is temporarily busy. Showing saved steps; try syncing again shortly.'
            : 'Could not connect to Google Health. Showing saved steps.',
        };
        notify();
      }
      if (listeners.size && (!(err instanceof ApiError) || [0,429,502,503,504].includes(err.status))
        && !(err instanceof DOMException && err.name === 'AbortError')) {
        recovery.schedule(() => syncGoogleHealth(true), err instanceof ApiError ? err.retryAfterMs ?? 5000 : 5000);
      }
      throw err;
    } finally {
      if (epoch === generation) inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

export function formatGoogleHealthTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
}

export function resetGoogleHealthState() {
  resetIntegrationDispatch();
  generation++;
  recovery.reset();
  clearTimeout(dataSyncTimer);
  dataSyncTimer = undefined;
  lastDataSync = 0;
  dataSyncAgain = false;
  dataSyncFlight = null;
  memoryState = initialGoogleHealthState;
  lastFetchTime = 0;
  inFlightPromise = null;
  notify();
}

function scheduleDataSync(force: boolean, committedWork = false) {
  if (committedWork && dataSyncFlight) { dataSyncAgain = true; return; }
  const pending = memoryState.weightSync.pendingCount + memoryState.nutritionSync.pendingCount + memoryState.bodyFatSync.pendingCount;
  if ((!committedWork && (memoryState.status !== 'connected' || (!pending && !memoryState.weightImport.enabled)))
    || dataSyncFlight || dataSyncTimer !== undefined || (!committedWork && !force && Date.now() - lastDataSync < 120000)) return;
  const epoch = generation;
  dataSyncTimer = setTimeout(() => {
    dataSyncTimer = undefined;
    if (epoch !== generation) return;
    lastDataSync = Date.now();
    const previousImportSuccess = memoryState.weightImport.lastSuccessAt;
    dataSyncFlight = api<GoogleHealthSyncState>('/integrations/google-health/sync-data', {force, ...(committedWork ? {outboundOnly: true} : {})}).then(result => {
      if (epoch !== generation) return;
      // This request owns upload/import status, not the concurrently refreshed step snapshot.
      memoryState = {...memoryState, weightSync: result.weightSync ?? memoryState.weightSync,
        nutritionSync: result.nutritionSync ?? memoryState.nutritionSync, bodyFatSync: result.bodyFatSync ?? memoryState.bodyFatSync,
        weightImport: result.weightImport ?? memoryState.weightImport};
      notify();
      if (!committedWork && result.weightImport?.lastImportedCount && result.weightImport.lastSuccessAt !== previousImportSuccess)
        window.dispatchEvent(new Event('nutrition:imported-weights'));
    }).catch(() => { /* Durable work remains queued for a later active pass or the daily sweep. */ })
      .finally(() => {
        if (epoch !== generation) return;
        dataSyncFlight = null;
        if (dataSyncAgain) { dataSyncAgain = false; scheduleDataSync(false, true); }
      });
  }, 250);
}

/**
 * Calculates the average of days with known step counts.
 * Missing dates (null) and an optionally excluded date (such as today) are excluded from the average.
 * If there are zero known days, returns null.
 */
export function calculateKnownDayAverage(days: GoogleHealthDay[], excludeDate?: string): number | null {
  const eligible = excludeDate ? days.filter(d => d.date !== excludeDate) : days;
  const known = eligible.filter((d): d is GoogleHealthDay & { count: number } => d.count !== null && d.count !== undefined);
  if (known.length === 0) return null;
  const total = known.reduce((acc, d) => acc + d.count, 0);
  return Math.round(total / known.length);
}

export function getTodayStepCount(days: GoogleHealthDay[], todayDate: string): number | null {
  const item = days.find(d => d.date === todayDate);
  return item?.count ?? null;
}

export function shouldShowDashboardSteps(state: Pick<GoogleHealthSyncState, 'status' | 'connectedAt'>, loading: boolean): boolean {
  return state.status === 'connected' && (!loading || state.connectedAt !== null);
}

export function useGoogleHealth(enabled = true) {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => initialGoogleHealthState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (state.freshness === 'fresh') setError(''); }, [state]);

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
        void refresh(consumeGoogleHealthHandoff());
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

if (typeof window !== 'undefined') window.addEventListener('fitness:integration-pending', () => scheduleDataSync(false, true));

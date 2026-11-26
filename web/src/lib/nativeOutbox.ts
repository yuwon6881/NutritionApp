import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { LocalData, Mutation, SyncAcknowledgement } from '../types';

export interface NativeSyncOutcome {
  id: string;
  mutation?: Mutation;
  outcome: 'acked' | 'conflict' | 'rejected';
  revision?: number;
  message?: string;
  ack?: SyncAcknowledgement;
}

const native = registerPlugin<{
  syncPendingMutations(options: {
    accountId: string;
    origin: string;
    queue: Mutation[];
    immediate: boolean;
  }): Promise<void>;
  readSyncedMutations(options: { accountId: string }): Promise<{ outcomes: NativeSyncOutcome[] }>;
  retireSyncedMutations(options: { accountId: string; ids: string[] }): Promise<void>;
  clearPendingMutations(options: { accountId: string }): Promise<void>;
}>('NutritionDevice');

function available(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NutritionDevice');
}

export async function syncNativeOutbox(
  accountId: string,
  queue: readonly Mutation[],
  immediate: boolean
): Promise<void> {
  if (!available() || typeof window === 'undefined') return;
  await native.syncPendingMutations({
    accountId,
    origin: window.location.origin,
    queue: [...queue],
    immediate
  }).catch(() => undefined);
}

async function readNativeOutboxOutcomes(accountId: string): Promise<NativeSyncOutcome[]> {
  if (!available()) return [];
  try {
    const result = await native.readSyncedMutations({ accountId });
    return Array.isArray(result?.outcomes) ? result.outcomes : [];
  } catch {
    return [];
  }
}

export async function reconcileNativeOutcomes(
  accountId: string,
  isAlive: () => boolean,
  commit: (change: (data: LocalData) => LocalData) => Promise<void>
): Promise<boolean> {
  const outcomes = await readNativeOutboxOutcomes(accountId);
  if (!outcomes.length || !isAlive()) return false;
  const resolver = await import('./outboxBackgroundResolve');
  const acknowledged = await resolver.acknowledgeNativeOutcomes(outcomes, isAlive, commit);
  if (isAlive()) await native.retireSyncedMutations({ accountId, ids: outcomes.map(outcome => outcome.id) });
  return acknowledged;
}

export async function clearNativeOutbox(accountId: string): Promise<void> {
  if (!available()) return;
  await native.clearPendingMutations({ accountId }).catch(() => undefined);
}

export async function subscribeNativeAppLifecycle(
  onForeground: () => void,
  onBackground: () => void
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  try {
    const handle = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) onForeground();
      else onBackground();
    });
    return () => { void handle.remove(); };
  } catch {
    return () => undefined;
  }
}

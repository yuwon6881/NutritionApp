import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Mutation, SyncAcknowledgement } from '../types';

export interface NativeSyncOutcome {
  id: string;
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
  consumeSyncedMutations(options: { accountId: string }): Promise<{ outcomes: NativeSyncOutcome[] }>;
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

export async function consumeNativeOutboxOutcomes(accountId: string): Promise<NativeSyncOutcome[]> {
  if (!available()) return [];
  try {
    const result = await native.consumeSyncedMutations({ accountId });
    return Array.isArray(result?.outcomes) ? result.outcomes : [];
  } catch {
    return [];
  }
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

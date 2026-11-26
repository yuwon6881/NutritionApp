import { Capacitor } from '@capacitor/core';
import type { LocalData, Mutation } from '../types';
import { releaseHeldMutations, selectKeepaliveBatch } from './heldMutations';
import { wireMutation } from './projection';
import type { NativeSyncOutcome } from './nativeOutbox';

type Commit = (change: (data: LocalData) => LocalData) => Promise<void>;

/** Registers a Service Worker Background Sync wake-up when the browser supports SyncManager. */
export function registerOutboxBackgroundSync(): void {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return;
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  void navigator.serviceWorker.ready
    .then(registration =>
      (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register('nutrition-outbox')
    )
    .catch(() => undefined);
}

export function syncNativeBackgroundOutbox(accountId: string, queue: readonly Mutation[], immediate: boolean): void {
  if (!Capacitor.isNativePlatform()) return;
  void import('./nativeOutbox').then(module => module.syncNativeOutbox(accountId, queue, immediate)).catch(() => undefined);
}

export async function consumeNativeBackgroundResults(accountId: string): Promise<NativeSyncOutcome[]> {
  if (!Capacitor.isNativePlatform()) return [];
  const module = await import('./nativeOutbox');
  return module.consumeNativeOutboxOutcomes(accountId);
}

export async function clearNativeBackgroundOutbox(accountId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const module = await import('./nativeOutbox').catch(() => undefined);
  await module?.clearNativeOutbox(accountId);
}

export async function subscribeNativeBackgroundLifecycle(
  onForeground: () => void,
  onBackground: () => void
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  try {
    const module = await import('./nativeOutbox');
    return await module.subscribeNativeAppLifecycle(onForeground, onBackground);
  } catch {
    return () => undefined;
  }
}

export async function reconcileNativeOutbox(
  user: string,
  isAlive: () => boolean,
  commit: Commit
): Promise<boolean> {
  const outcomes = await consumeNativeBackgroundResults(user);
  if (!outcomes.length || !isAlive()) return false;
  const resolver = await import('./outboxBackgroundResolve');
  return resolver.acknowledgeNativeOutcomes(outcomes, isAlive, commit);
}

export interface KeepaliveFlushContext {
  user: string;
  queue: readonly Mutation[];
  inFlight: Map<string, Promise<void>>;
  isAlive: () => boolean;
  commit: Commit;
  onErrorClear: () => void;
  onRejectedNotice: (message: string) => void;
  onSessionExpired: () => void;
  onSettled: () => void;
}

/**
 * Fires keepalive POST /api/sync requests synchronously inside visibilitychange/pagehide
 * so queued edits still reach the server even when the mobile browser or WebView freezes immediately.
 */
export function dispatchKeepaliveBatch(context: KeepaliveFlushContext): void {
  const { user, queue, inFlight, isAlive, commit, onErrorClear, onRejectedNotice, onSessionExpired, onSettled } = context;
  const batch = selectKeepaliveBatch(queue, Date.now(), new Set(inFlight.keys()));
  for (const op of batch) {
    const promise = (async () => {
      try {
        const response = await fetch('/api/sync', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            'X-Nutrition-Request': '1',
            'X-Nutrition-Account': user,
            'X-Fitness-Integration-Dispatch': 'deferred'
          },
          body: JSON.stringify(wireMutation(op))
        });
        if (!isAlive()) return;
        const resolver = await import('./outboxBackgroundResolve');
        await resolver.resolveKeepaliveResponse({
          op, response, isAlive, commit, onErrorClear, onRejectedNotice, onSessionExpired
        });
      } catch {
        if (!isAlive()) return;
        const resolver = await import('./outboxBackgroundResolve');
        await resolver.resolveKeepaliveNetworkFailure(op, isAlive, commit);
      } finally {
        inFlight.delete(op.id);
        if (isAlive()) onSettled();
      }
    })();
    inFlight.set(op.id, promise);
  }
}

export function flushBackgroundOutbox(options: {
  user: string;
  queue: Mutation[];
  canSend: boolean;
  draining: boolean;
  inFlight: Map<string, Promise<void>>;
  isAlive: () => boolean;
  commit: Commit;
  dismissUndo: () => void;
  onErrorClear: () => void;
  onRejectedNotice: (message: string) => void;
  onSessionExpired: () => void;
  onSettled: () => void;
}): void {
  const {
    user, queue, canSend, draining, inFlight, isAlive, commit,
    dismissUndo, onErrorClear, onRejectedNotice, onSessionExpired, onSettled
  } = options;
  const hadHeld = queue.some(op => op.holdUntil !== undefined);
  const nextQueue = hadHeld ? releaseHeldMutations(queue) : queue;
  if (hadHeld) {
    dismissUndo();
    void commit(current => {
      const released = releaseHeldMutations(current.queue);
      return released === current.queue ? current : { ...current, queue: released };
    });
  }
  registerOutboxBackgroundSync();
  syncNativeBackgroundOutbox(user, nextQueue, true);
  if (!canSend || draining) return;
  dispatchKeepaliveBatch({
    user,
    queue: nextQueue,
    inFlight,
    isAlive,
    commit,
    onErrorClear,
    onRejectedNotice,
    onSessionExpired,
    onSettled
  });
}

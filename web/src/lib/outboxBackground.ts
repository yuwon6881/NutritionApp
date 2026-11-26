import { Capacitor } from '@capacitor/core';
import type { LocalData, Mutation } from '../types';
import { integrationGeneration, signalIntegrationPending } from './integrationDispatch';
import { releaseHeldMutations, selectKeepaliveBatch } from './heldMutations';
import { wireMutation } from './projection';

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

export function syncNativeBackgroundOutbox(accountId: string, queue: readonly Mutation[], immediate: boolean): void | Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  return import('./nativeOutbox').then(module => module.syncNativeOutbox(accountId, queue, immediate)).catch(() => undefined);
}

export async function clearNativeBackgroundOutbox(accountId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const module = await import('./nativeOutbox').catch(() => undefined);
  await module?.clearNativeOutbox(accountId);
}

export function subscribeOutboxLifecycle(
  onForeground: () => void,
  onBackground: () => void
): () => void {
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') onBackground();
    else onForeground();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onBackground);
  window.addEventListener('pageshow', onForeground);

  let disposed = false;
  let stopNative: (() => void) | undefined;
  if (Capacitor.isNativePlatform()) {
    void import('./nativeOutbox').then(module => module.subscribeNativeAppLifecycle(onForeground, onBackground))
      .then(stop => {
        if (disposed) stop();
        else stopNative = stop;
      }).catch(() => undefined);
  }
  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onBackground);
    window.removeEventListener('pageshow', onForeground);
    stopNative?.();
  };
}

export async function reconcileNativeOutbox(
  user: string,
  isAlive: () => boolean,
  commit: Commit
): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const module = await import('./nativeOutbox');
  return module.reconcileNativeOutcomes(user, isAlive, commit);
}

export interface KeepaliveFlushContext {
  user: string;
  queue: readonly Mutation[];
  inFlight: Map<string, Promise<void>>;
  inFlightDrain?: ReadonlyMap<string, Mutation>;
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
  const { user, queue, inFlight, inFlightDrain, isAlive, commit, onErrorClear, onRejectedNotice, onSessionExpired, onSettled } = context;
  // Closing can cancel the foreground fetch. Replay its exact request under the same
  // receipt ID and leave later edits behind it until either delivery is acknowledged.
  const sending = inFlightDrain?.get(queue[0]?.id);
  const batch = selectKeepaliveBatch(sending ? [sending] : queue, Date.now(), new Set(inFlight.keys()));
  const integrationEpoch = integrationGeneration();
  for (const op of batch) {
    const promise = (async () => {
      try {
        const response = await fetch('/api/sync', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          keepalive: true,
          signal: AbortSignal.timeout(20_000),
          headers: {
            'Content-Type': 'application/json',
            'X-Nutrition-Request': '1',
            'X-Nutrition-Account': user,
            'X-Fitness-Integration-Dispatch': 'deferred'
          },
          body: JSON.stringify(wireMutation(op))
        });
        if (!isAlive() || inFlightDrain?.has(op.id)) return;
        if (response.ok && response.headers.get('X-Fitness-Integration-Pending') === '1') {
          signalIntegrationPending(integrationEpoch);
        }
        const resolver = await import('./outboxBackgroundResolve');
        await resolver.resolveKeepaliveResponse({
          op, response, isAlive, commit, onErrorClear, onRejectedNotice, onSessionExpired
        });
      } catch {
        if (!isAlive() || inFlightDrain?.has(op.id)) return;
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

export function flushBackgroundOutbox({ canSend, dismissUndo, ...context }: KeepaliveFlushContext & {
  queue: Mutation[];
  canSend: boolean;
  dismissUndo: () => void;
}): void {
  const { user, queue, commit } = context;
  const nextQueue = releaseHeldMutations(queue);
  if (nextQueue !== queue) {
    const heldIds = queue.filter(op => op.holdUntil !== undefined).map(op => op.id);
    dismissUndo();
    void commit(current => {
      const released = releaseHeldMutations(current.queue, heldIds);
      return released === current.queue ? current : { ...current, queue: released };
    }).catch(() => undefined);
  }
  registerOutboxBackgroundSync();
  void syncNativeBackgroundOutbox(user, nextQueue, true);
  if (canSend) dispatchKeepaliveBatch({ ...context, queue: nextQueue });
}

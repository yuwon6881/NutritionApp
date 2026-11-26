import type { LocalData, Mutation, SyncAcknowledgement } from '../types';
import { sharedDiaryCoordinator } from './diaryCoordinator';
import { retainMutationConflict } from './mutationConflicts';
import { acknowledgeLocalWrite } from './nutritionAcknowledgement';
import { markForRetry, retireRejectedMutation } from './projection';
import { rejectedEditMessage } from './rejectedEdit';
import { classifySyncStatus, parseRetryAfterMs } from './syncFailureStatus';
import type { NativeSyncOutcome } from './nativeOutbox';

type Commit = (change: (data: LocalData) => LocalData) => Promise<void>;

/** Applies mutations already resolved natively by WorkManager while the WebView was paused or closed. */
export function applyNativeSyncOutcomes(
  current: LocalData,
  outcomes: readonly NativeSyncOutcome[]
): { next: LocalData; acked: Array<{ op: Mutation; revision: number; ack?: SyncAcknowledgement }>; changed: boolean } {
  if (!outcomes.length) return { next: current, acked: [], changed: false };
  let next = current;
  let changed = false;
  const acked: Array<{ op: Mutation; revision: number; ack?: SyncAcknowledgement }> = [];

  for (const outcome of outcomes) {
    const op = next.queue.find(item => item.id === outcome.id);
    if (!op) continue;
    changed = true;
    if (outcome.outcome === 'acked' && typeof outcome.revision === 'number') {
      next = acknowledgeLocalWrite(next, op, outcome.revision, outcome.ack);
      acked.push({ op, revision: outcome.revision, ack: outcome.ack });
    } else if (outcome.outcome === 'conflict') {
      next = retainMutationConflict(next, op, outcome.message || 'This change conflicts with saved data.', Date.now());
    } else if (outcome.outcome === 'rejected') {
      next = { ...next, queue: retireRejectedMutation(next.queue, op) };
    }
  }
  return { next, acked, changed };
}

export async function acknowledgeNativeOutcomes(
  outcomes: readonly NativeSyncOutcome[],
  isAlive: () => boolean,
  commit: Commit
): Promise<boolean> {
  if (!outcomes.length || !isAlive()) return false;
  let acked: Array<{ op: Mutation; revision: number; ack?: SyncAcknowledgement }> = [];
  await commit(current => {
    const applied = applyNativeSyncOutcomes(current, outcomes);
    acked = applied.acked;
    return applied.changed ? applied.next : current;
  });
  for (const item of acked) await sharedDiaryCoordinator.acknowledge(item.op, item.revision, item.ack?.days ?? undefined);
  return acked.length > 0;
}

export async function resolveKeepaliveResponse(options: {
  op: Mutation;
  response: Response;
  isAlive: () => boolean;
  commit: Commit;
  onErrorClear: () => void;
  onRejectedNotice: (message: string) => void;
  onSessionExpired: () => void;
}): Promise<void> {
  const { op, response, isAlive, commit, onErrorClear, onRejectedNotice, onSessionExpired } = options;
  if (!isAlive()) return;
  if (response.ok) {
    const ack = await response.json() as SyncAcknowledgement;
    await commit(current => acknowledgeLocalWrite(current, op, ack.revision, ack));
    await sharedDiaryCoordinator.acknowledge(op, ack.revision, ack.days ?? undefined);
    onErrorClear();
    return;
  }
  const failure = classifySyncStatus(response.status);
  if (failure === 'session-expired') {
    onSessionExpired();
    return;
  }
  if (failure === 'conflict') {
    let message = 'This change conflicts with saved data.';
    try {
      const json = await response.json() as { message?: unknown };
      if (typeof json.message === 'string' && json.message) message = json.message;
    } catch { /* non-JSON error */ }
    await commit(current => retainMutationConflict(current, op, message, Date.now()));
    return;
  }
  if (failure === 'rejected') {
    await commit(current => ({ ...current, queue: retireRejectedMutation(current.queue, op) }));
    onRejectedNotice(rejectedEditMessage(op));
    return;
  }
  const retryMs = parseRetryAfterMs(response.headers.get('Retry-After'), 5000);
  await commit(current => ({ ...current, queue: markForRetry(current.queue, op, Date.now() + retryMs) }));
}

export async function resolveKeepaliveNetworkFailure(op: Mutation, isAlive: () => boolean, commit: Commit): Promise<void> {
  if (!isAlive()) return;
  await commit(current => ({ ...current, queue: markForRetry(current.queue, op, Date.now() + 5000) }));
}

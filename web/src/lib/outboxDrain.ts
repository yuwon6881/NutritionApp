import type { LocalData, Mutation, SyncAcknowledgement } from '../types';
import { api, ApiError } from './api';
import { renewAccountDispatch } from './accountWork';
import { sharedDiaryCoordinator } from './diaryCoordinator';
import { dispatchWait, nextDispatchableMutation } from './heldMutations';
import { markForRetry, retireRejectedMutation, wireMutation } from './projection';
import { rejectedEditMessage } from './rejectedEdit';
import { classifySyncFailure } from './syncFailure';
import { retainMutationConflict } from './mutationConflicts';

export interface DrainLoopOptions {
  user: string;
  isAlive: () => boolean;
  isSessionExpired: () => boolean;
  getQueue: () => Mutation[] | undefined;
  inFlightKeepalive: Map<string, Promise<void>>;
  commit: (change: (data: LocalData) => LocalData) => Promise<void>;
  setSendingRecordId: (id: string | undefined) => void;
  scheduleRetry: (delayMs: number) => void;
  onSessionExpired: () => void;
  onRejectedNotice: (message: string) => void;
}

export async function runOutboxDrainLoop(options: DrainLoopOptions): Promise<boolean> {
  const {
    user, isAlive, isSessionExpired, getQueue, inFlightKeepalive, commit,
    setSendingRecordId, scheduleRetry, onSessionExpired, onRejectedNotice
  } = options;
  let sent = false;

  while (isAlive() && !isSessionExpired() && getQueue()?.length && await renewAccountDispatch(user)) {
    const op = nextDispatchableMutation(getQueue()!);
    if (!op) break;
    const inFlight = inFlightKeepalive.get(op.id);
    if (inFlight) {
      await inFlight;
      if (!getQueue()?.some(item => item.id === op.id)) sent = true;
      continue;
    }
    // An undoable operation at the head waits out its window; later work stays behind it in order.
    const wait = dispatchWait([op], Date.now());
    if (wait > 0) {
      scheduleRetry(wait + 20);
      break;
    }
    try {
      setSendingRecordId(op.recordId);
      const acknowledgement = await api<SyncAcknowledgement>(
        '/sync', wireMutation(op), undefined, { headers: { 'X-Nutrition-Account': user } }
      ).finally(() => { if (isAlive()) setSendingRecordId(undefined); });
      const { revision } = acknowledgement;
      sent = true;
      const { acknowledgeLocalWrite } = await import('./nutritionAcknowledgement');
      await commit(current => acknowledgeLocalWrite(current, op, revision, acknowledgement));
      await sharedDiaryCoordinator.acknowledge(op, revision, acknowledgement.days ?? undefined);
    } catch (ex) {
      const failure = classifySyncFailure(ex);
      if (failure === 'session-expired') onSessionExpired();
      if (failure === 'conflict') {
        await commit(current => retainMutationConflict(
          current, op, ex instanceof ApiError ? ex.message : 'This change conflicts with saved data.', Date.now()
        ));
        sent = true;
        continue;
      }
      if (failure === 'rejected') {
        // A terminal rejection leaves the saved server record in place so later queued work continues.
        await commit(current => ({ ...current, queue: retireRejectedMutation(current.queue, op) }));
        sent = true;
        onRejectedNotice(rejectedEditMessage(op));
        continue;
      }
      if (failure === 'retry') {
        const retryDelay = ex instanceof ApiError ? ex.retryAfterMs ?? 5000 : 5000;
        scheduleRetry(retryDelay + 20);
        await commit(current => ({ ...current, queue: markForRetry(current.queue, op, Date.now() + retryDelay) }));
      }
      throw ex;
    }
  }
  return sent;
}

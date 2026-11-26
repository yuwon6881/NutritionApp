import {ApiError} from './api';
import {classifySyncStatus,type SyncFailure} from './syncFailureStatus';

export type {SyncFailure};

/**
 * How the outbox treats a failed diary request. A terminal rejection drops that one edit; an
 * expired session stops sending (retrying cannot succeed until the user signs in again, and the
 * queued work must be kept for that); anything else is retried on the next wake. A request the server
 * will never accept (forbidden, not found, too large) is terminal too: retrying would block every edit queued behind it.
 */
export function classifySyncFailure(ex:unknown):SyncFailure{
  if(!(ex instanceof ApiError))return 'retry';
  return classifySyncStatus(ex.status);
}

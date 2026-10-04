import {ApiError} from './api';

/**
 * How the outbox treats a failed diary request. A terminal rejection drops that one edit; an
 * expired session stops sending (retrying cannot succeed until the user signs in again, and the
 * queued work must be kept for that); anything else is retried on the next wake.
 */
export type SyncFailure='rejected'|'session-expired'|'retry';

const terminal=[400,409,422];

export function classifySyncFailure(ex:unknown):SyncFailure{
  if(!(ex instanceof ApiError))return 'retry';
  if(terminal.includes(ex.status))return 'rejected';
  if(ex.status===401)return 'session-expired';
  return 'retry';
}

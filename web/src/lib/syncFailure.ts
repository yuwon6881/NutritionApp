import {ApiError} from './api';

/**
 * How the outbox treats a failed diary request. A terminal rejection drops that one edit; an
 * expired session stops sending (retrying cannot succeed until the user signs in again, and the
 * queued work must be kept for that); anything else is retried on the next wake. A request the server
 * will never accept (forbidden, not found, too large) is terminal too: retrying would block every edit queued behind it.
 */
export type SyncFailure='rejected'|'session-expired'|'retry';

const terminal=[400,403,404,409,413,422];

export function classifySyncFailure(ex:unknown):SyncFailure{
  if(!(ex instanceof ApiError))return 'retry';
  if(terminal.includes(ex.status))return 'rejected';
  if(ex.status===401)return 'session-expired';
  return 'retry';
}

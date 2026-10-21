import type {CardFeedbackTone} from '../components/ui/CardFeedback';
import type {GoogleHealthItemSyncStatus} from './googleHealth';

export type UploadFailureAction = 'retry' | 'reconnect';

export interface UploadFailureView {
  tone: CardFeedbackTone;
  title: string;
  message: string;
  /** One line per affected stream with the server's own wording, behind a disclosure. */
  detail?: string;
  action: UploadFailureAction;
  actionLabel: string;
}

export interface UploadStream {
  label: string;
  status: Pick<GoogleHealthItemSyncStatus, 'state' | 'failureCode' | 'failureMessage'>;
}

const RECONNECT_CODES = new Set(['reconnect_required', 'permission_missing']);
const TEMPORARY_CODES = new Set(['rate_limit_exceeded', 'provider_unavailable', 'provider_error']);

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function detailLines(streams: UploadStream[]): string | undefined {
  const lines = streams
    .map(({label, status}) => {
      const text = status.failureMessage?.trim();
      return text ? `${label}: ${text}` : null;
    })
    .filter((line): line is string => line !== null);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Describes failed or uncertain Google Health uploads across the outbound streams, or null when
 * nothing needs attention. An uncertain upload outranks a failure because retrying it can
 * duplicate data that may already exist.
 */
export function describeUploadFailure(streams: UploadStream[]): UploadFailureView | null {
  const unknown = streams.filter(stream => stream.status.state === 'unknown');
  const failed = streams.filter(stream => stream.status.state === 'failed');

  if (unknown.length > 0) {
    const names = joinLabels(unknown.map(stream => stream.label.toLowerCase()));
    return {
      tone: 'warning',
      title: 'Upload may have gone through',
      message: `Google Health did not confirm the ${names} upload. Check Google Health first: retrying can add a second copy.`,
      detail: detailLines(unknown),
      action: 'retry',
      actionLabel: 'Retry anyway',
    };
  }
  if (failed.length === 0) return null;

  const names = joinLabels(failed.map(stream => stream.label.toLowerCase()));
  const codes = failed.map(stream => stream.status.failureCode ?? '');
  const detail = detailLines(failed);

  if (codes.some(code => RECONNECT_CODES.has(code))) {
    return {
      tone: 'error',
      title: 'Google Health needs your permission',
      message: `The ${names} upload cannot continue until Google Health is reconnected with write access. Your entries stay saved here.`,
      detail,
      action: 'reconnect',
      actionLabel: 'Reconnect',
    };
  }
  if (codes.every(code => TEMPORARY_CODES.has(code))) {
    return {
      tone: 'warning',
      title: 'Google Health is not responding',
      message: `The ${names} upload was paused by Google Health. Your entries stay saved here; try again in a few minutes.`,
      detail,
      action: 'retry',
      actionLabel: 'Try again',
    };
  }
  return {
    tone: 'error',
    title: `Couldn't upload ${names}`,
    message: 'Your entries are saved here and are not lost. Retry sends them to Google Health again.',
    detail,
    action: 'retry',
    actionLabel: 'Retry upload',
  };
}

const connectErrors: Record<string, string> = {
  duplicate_account: 'This Google account is already linked to another NutritionApp account.',
  identity_change_requires_disconnect: 'Disconnect the current Google account before connecting a different one.',
  session_mismatch: 'Session expired during connection. Please sign in and try again.',
  session_expired: 'Session expired during connection. Please sign in and try again.',
  access_denied: 'Access was denied in Google permissions.',
  invalid_state: 'Connection session expired. Please try again.',
  identity_resolution_failed: 'Google account identity could not be confirmed. Try again.',
  token_exchange_failed: 'Could not complete authorization exchange with Google.',
  missing_tokens: 'Required authorization tokens were missing. Please reconnect.',
  encryption_failed: 'Could not securely store the Google connection. Try again later.',
  missing_parameters: 'Google returned an incomplete response. Please try again.',
  invalid_scope: 'Requested Google Health permissions are not enabled for this app.',
  provider_error: 'Google returned an unexpected authorization error.',
};

/** Plain wording for the error code the consent callback returns in `?google_health=error&code=`. */
export function describeConnectError(code: string | null): string {
  return (code && connectErrors[code]) || 'Google Health connection was not completed.';
}

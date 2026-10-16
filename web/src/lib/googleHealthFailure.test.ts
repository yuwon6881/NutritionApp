import {describe, expect, it} from 'vitest';
import {describeUploadFailure, type UploadStream} from './googleHealthFailure';

const stream = (label: string, state: string, failureCode?: string, failureMessage?: string): UploadStream => ({
  label,
  status: {state: state as UploadStream['status']['state'], failureCode, failureMessage},
});

describe('describeUploadFailure', () => {
  it('is silent while every stream is healthy', () => {
    expect(describeUploadFailure([stream('Weight', 'idle'), stream('Nutrition', 'pending')])).toBeNull();
  });

  it('names the failed streams and lists the server wording per stream', () => {
    const view = describeUploadFailure([
      stream('Weight', 'idle'),
      stream('Nutrition', 'failed', 'provider_validation', 'Google Health rejected the entry'),
      stream('Body fat', 'failed', 'provider_validation', 'Body fat out of range'),
    ]);
    expect(view?.title).toBe("Couldn't upload nutrition and body fat");
    expect(view?.detail).toBe('Nutrition: Google Health rejected the entry\nBody fat: Body fat out of range');
    expect(view).toMatchObject({tone: 'error', action: 'retry'});
  });

  it('prefers reconnecting when any stream lost permission', () => {
    const view = describeUploadFailure([
      stream('Weight', 'failed', 'provider_validation'),
      stream('Nutrition', 'failed', 'permission_missing'),
    ]);
    expect(view).toMatchObject({action: 'reconnect', actionLabel: 'Reconnect'});
  });

  it('calls an outage temporary only when every failure is', () => {
    expect(describeUploadFailure([stream('Weight', 'failed', 'rate_limit_exceeded')]))
      .toMatchObject({tone: 'warning', actionLabel: 'Try again'});
    expect(describeUploadFailure([
      stream('Weight', 'failed', 'rate_limit_exceeded'),
      stream('Nutrition', 'failed', 'provider_validation'),
    ])).toMatchObject({tone: 'error', actionLabel: 'Retry upload'});
  });

  it('puts an uncertain upload ahead of a failure and warns about duplicates', () => {
    const view = describeUploadFailure([
      stream('Weight', 'failed', 'provider_validation'),
      stream('Nutrition', 'unknown', 'upload_status_unknown'),
    ]);
    expect(view).toMatchObject({tone: 'warning', actionLabel: 'Retry anyway'});
    expect(view?.message).toContain('nutrition upload');
    expect(view?.message).toContain('second copy');
  });
});

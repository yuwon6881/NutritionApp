import {describe, expect, it, vi} from 'vitest';
import {createDelayedPendingScheduler} from '../../lib/delayedPending';

describe('useDelayedPending pure scheduler', () => {
  it('does not trigger pending status before 300ms', () => {
    vi.useFakeTimers();
    const onPending = vi.fn();
    const scheduler = createDelayedPendingScheduler(300);

    scheduler.start(onPending);
    vi.advanceTimersByTime(299);
    expect(onPending).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onPending).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('cancels pending status if loading finishes before 300ms', () => {
    vi.useFakeTimers();
    const onPending = vi.fn();
    const scheduler = createDelayedPendingScheduler(300);

    scheduler.start(onPending);
    vi.advanceTimersByTime(150);
    scheduler.cancel();

    vi.advanceTimersByTime(250);
    expect(onPending).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

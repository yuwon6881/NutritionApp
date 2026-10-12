export interface DelayedPendingScheduler {
  start: (onPending: () => void) => void;
  cancel: () => void;
}

/**
 * Creates a timer scheduler that delays invoking a pending callback until `delayMs` elapses.
 * Calling `cancel()` prevents the callback from firing.
 */
export function createDelayedPendingScheduler(delayMs = 300): DelayedPendingScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    start(onPending: () => void) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onPending();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

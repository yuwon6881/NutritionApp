import {useEffect, useState} from 'react';
import {createDelayedPendingScheduler} from '../../lib/delayedPending';

/**
 * Returns true if `active` remains true continuously for longer than `delayMs`.
 * Cancels and resets to false immediately as soon as `active` becomes false.
 */
export function useDelayedPending(active: boolean, delayMs = 300): boolean {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!active) {
      setPending(false);
      return;
    }
    const scheduler = createDelayedPendingScheduler(delayMs);
    scheduler.start(() => setPending(true));
    return () => {
      scheduler.cancel();
    };
  }, [active, delayMs]);

  return pending;
}

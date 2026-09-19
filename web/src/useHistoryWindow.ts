import { useEffect, useMemo, useState } from 'react';
import type { AppState } from './types';
import type { Nourish } from './useNourish';
import { sharedDiaryCoordinator } from './lib/diaryCoordinator';
import { today } from './lib/format';
import { historyState } from './lib/history';

export function useHistoryWindow(store: Nourish, key: string, enabled = true) {
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [attempt, setAttempt] = useState(0);
  const [, setTick] = useState(0);
  const forceUpdate = () => setTick(n => n + 1);

  const todayDate = today(store.state?.profile?.timeZone);
  const queue = store.local?.queue ?? [];

  // Check if date is cached in coordinator or local state
  const cached = sharedDiaryCoordinator.projectDate(key, queue);
  const isCached = cached !== undefined || (store.local?.state ? historyState(store.local, key) !== undefined : false);
  const [loading, setLoading] = useState(!isCached && enabled);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const unsubscribe = sharedDiaryCoordinator.subscribe((updatedDate) => {
      if (!updatedDate || updatedDate === key) {
        forceUpdate();
      }
    });

    let active = true;
    const isFresh = sharedDiaryCoordinator.isFresh(key, todayDate);

    if (!sharedDiaryCoordinator.getCached(key)) {
      setLoading(true);
    }

    if (!isFresh) {
      (async () => {
        try {
          await store.refreshHistory(key);
          if (active) {
            setFailure(undefined);
            setLoading(false);
          }
        } catch (ex) {
          if (active) {
            setFailure({ key, message: (ex as Error).message });
            setLoading(false);
          }
        }
      })();
    } else {
      setLoading(false);
    }

    const wake = () => {
      if (document.visibilityState === 'visible' && !sharedDiaryCoordinator.isFresh(key, todayDate)) {
        void store.refreshHistory(key).catch(ex => {
          if (active) setFailure({ key, message: (ex as Error).message });
        });
      }
    };

    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [key, enabled, store.calendarDate, attempt, store.refreshHistory, todayDate]);

  const state = useMemo<AppState | undefined>(() => {
    if (!enabled) return undefined;
    const base = store.local?.state ?? store.state;
    if (!base) return undefined;

    const projected = sharedDiaryCoordinator.projectDate(key, queue);
    if (projected) {
      return {
        ...base,
        entries: projected.entries,
        days: projected.day ? [projected.day] : []
      };
    }

    if (store.local) {
      return historyState(store.local, key);
    }
    return undefined;
  }, [enabled, key, queue, store.local, store.state]);

  return {
    state,
    error: failure?.key === key ? failure.message : '',
    loading,
    retry: () => setAttempt(n => n + 1)
  };
}

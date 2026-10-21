import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { LocalData, TrainingResponse } from './types';
import { apiWithMeta, ApiError } from './lib/api';
import { singleFlight } from './lib/singleFlight';

type Commit = (change: (data: LocalData) => LocalData) => Promise<void>;

export function useTrainingSummaries(
  user: string,
  ref: RefObject<LocalData | undefined>,
  alive: RefObject<boolean>,
  readController: RefObject<AbortController>,
  commit: Commit,
  lastPeerRefresh: RefObject<number>
) {
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainingResolved, setTrainingResolved] = useState(false);
  const trainingLiveAccount = useRef<string | null>(null);
  const trainingEtag = useRef<string | undefined>(undefined);
  const requests = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    trainingEtag.current = undefined;
    trainingLiveAccount.current = null;
    setTrainingLoading(false);
    setTrainingError(null);
    setTrainingResolved(false);
  }, [user]);

  const loadTrainingSummaries = useCallback(
    (force = false): Promise<void> =>
      singleFlight(requests.current, force ? 'force' : 'default', async () => {
        if (!alive.current || !navigator.onLine) return;
        setTrainingLoading(true);
        if (force) setTrainingError(null);
        try {
          if (!force && trainingLiveAccount.current !== user) {
            try {
              const cachedRes = await apiWithMeta<TrainingResponse & { lastSuccessAt?: string | null }>(
                '/training/summary?cacheOnly=true',
                { signal: readController.current.signal }
              );
              if (alive.current && cachedRes.data) {
                const cachedData = cachedRes.data;
                await commit(current => ({
                  ...current,
                  state: {
                    ...current.state,
                    trainingSummaries: cachedData.summaries ?? current.state.trainingSummaries ?? [],
                    trainingSyncedAt: cachedData.lastSuccessAt ?? current.state.trainingSyncedAt,
                    workoutConnected: cachedData.workoutConnected ?? current.state.workoutConnected
                  }
                }));
              }
            } catch (ex) {
              if (ex instanceof ApiError && (ex.status === 401 || ex.status === 403)) {
                if (alive.current) {
                  setTrainingError(ex.message);
                  setTrainingResolved(true);
                }
                return;
              }
            }
          }

          const liveRes = await apiWithMeta<TrainingResponse & { lastSuccessAt?: string | null }>(
            `/training/summary${force ? '?force=true' : ''}`,
            {
              headers: !force && trainingEtag.current ? { 'If-None-Match': trainingEtag.current } : undefined,
              signal: readController.current.signal
            }
          );
          if (!alive.current) return;
          if (liveRes.etag) trainingEtag.current = liveRes.etag;
          lastPeerRefresh.current = Date.now();
          trainingLiveAccount.current = user;
          setTrainingError(null);
          setTrainingResolved(true);
          if (liveRes.data) {
            const liveData = liveRes.data;
            await commit(current => ({
              ...current,
              state: {
                ...current.state,
                trainingSummaries: liveData.summaries ?? [],
                trainingSyncedAt: liveData.lastSuccessAt ?? new Date().toISOString(),
                workoutConnected: liveData.workoutConnected ?? current.state.workoutConnected,
                workoutWarning: liveData.workoutWarning ?? null
              }
            }));
          }
        } catch (ex) {
          if (!alive.current) return;
          if (ex instanceof Error && ex.name === 'AbortError') return;
          setTrainingError(ex instanceof Error ? ex.message : 'Workout training summaries are temporarily unavailable.');
          setTrainingResolved(true);
        } finally {
          if (alive.current) setTrainingLoading(false);
        }
      }),
    [alive, commit, lastPeerRefresh, readController, user]
  );

  return {
    loadTrainingSummaries,
    trainingLoading,
    trainingError,
    trainingResolved,
    trainingLiveAccount
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalData, TrainingSummary } from './types';
import { apiWithMeta, ApiError } from './lib/api';

type Ref<T> = { current: T };
export function useTrainingSummaries(user: string, ref: Ref<LocalData | undefined>, alive: Ref<boolean>,
  readController: Ref<AbortController>, commit: (change: (data: LocalData) => LocalData) => Promise<void>, lastPeerRefresh: Ref<number>) {
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainingResolved, setTrainingResolved] = useState(false);
  const trainingRequest = useRef<Promise<void> | null>(null);
  const trainingCacheAccount = useRef<string | null>(null);
  const trainingEtag = useRef<string | undefined>(undefined);
  const trainingLiveAccount = useRef<string | null>(null);
  useEffect(() => { trainingEtag.current = undefined; trainingLiveAccount.current = null; }, [user]);
  const loadTrainingSummaries = useCallback(async () => {
    if (!user) return;
    if (!navigator.onLine) {
      // Offline there will be no live answer; show what is cached instead of loading forever.
      setTrainingResolved(true);
      return;
    }
    if (trainingRequest.current) return trainingRequest.current;
    setTrainingLoading(true);
    setTrainingError(null);
    const signal = readController.current.signal;
    const task = (async () => {
      try {
        type SummaryResponse = { summaries: TrainingSummary[]; workoutConnected?: boolean; workoutWarning?: string | null; lastSuccessAt?: string | null };
        if (trainingCacheAccount.current !== user) {
          try {
            const cached = await apiWithMeta<SummaryResponse>('/training/summary?cacheOnly=true', { signal });
            if (cached.data && alive.current && ref.current?.state.id === user) await commit(current => ({ ...current, state: { ...current.state,
              trainingSummaries: cached.data!.summaries, trainingSyncedAt: cached.data!.lastSuccessAt, workoutConnected: cached.data!.workoutConnected, workoutWarning: cached.data!.workoutWarning } }));
          } catch (error) {
            if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
            // The optional snapshot must not prevent the authoritative live read.
          }
          trainingCacheAccount.current = user;
        }
        if (signal.aborted || !alive.current || ref.current?.state.id !== user) return;
        const res = await apiWithMeta<SummaryResponse>('/training/summary', {
          signal,
          headers: trainingEtag.current ? { 'If-None-Match': trainingEtag.current } : undefined
        });
        if (!alive.current || ref.current?.state.id !== user) return;
        trainingLiveAccount.current = user;
        if (res.etag) trainingEtag.current = res.etag;
        lastPeerRefresh.current = Date.now();
        if (res.data && alive.current) {
          await commit(current => ({ ...current, state: { ...current.state, trainingSummaries: res.data!.summaries, trainingSyncedAt: res.data!.lastSuccessAt, workoutConnected: res.data!.workoutConnected, workoutWarning: res.data!.workoutWarning } }));
        }
      } catch (ex) {
        if (alive.current) {
          setTrainingError(ex instanceof Error ? ex.message : 'Workout training summaries are temporarily unavailable.');
        }
      } finally {
        if (alive.current) {
          setTrainingLoading(false);
          setTrainingResolved(true);
        }
      }
    })().finally(() => {
      trainingRequest.current = null;
    });
    trainingRequest.current = task;
    return task;
  }, [commit, user]);
  return { loadTrainingSummaries, trainingLoading, trainingError, trainingResolved, trainingLiveAccount };
}

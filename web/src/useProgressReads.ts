import {useCallback,useRef,type RefObject} from 'react';
import type {LocalData,ProgressSummary} from './types';
import {apiWithMeta} from './lib/api';
import {progressDataKey} from './lib/progressFreshness';

/** Coalesce period reads and retry a response superseded by an acknowledged mutation. */
export function useProgressReads(ref:RefObject<LocalData|undefined>,alive:RefObject<boolean>,readController:RefObject<AbortController>,commit:(change:(data:LocalData)=>LocalData)=>Promise<void>){
  const progressSequences=useRef(new Map<string,number>());
  const progressRequests=useRef(new Map<string,Promise<void>>());
  const progressEtags=useRef(new Map<string,string>());
  const refreshProgress = useCallback((period: string):Promise<void> => {
    const running = progressRequests.current.get(period);
    if (running) return running;
    const sequence = (progressSequences.current.get(period) ?? 0) + 1;
    const dataKey=progressDataKey(ref.current?.state);
    progressSequences.current.set(period, sequence);
    const request = (async () => {
      const response = await apiWithMeta<ProgressSummary>('/progress/summary?period=' + encodeURIComponent(period),{
        headers:ref.current?.progress?.[period]&&progressEtags.current.has(period)?{'If-None-Match':progressEtags.current.get(period)!}:undefined,
        signal:readController.current.signal
      });
      if (!alive.current || progressSequences.current.get(period) !== sequence || dataKey!==progressDataKey(ref.current?.state)) return;
      const summary=response.data;
      if(!summary)return;
      await commit(current => {
        if(dataKey!==progressDataKey(current.state))return current;
        const previous = current.progress?.[period];
        if (previous && summary.revision < previous.revision) return current;
        return { ...current, progress: { ...(current.progress ?? {}), [period]: summary } };
      });
      if(response.etag&&ref.current?.progress?.[period]?.revision===summary.revision)progressEtags.current.set(period,response.etag);
    })().finally(() => {
      progressRequests.current.delete(period);
      if(alive.current&&dataKey!==progressDataKey(ref.current?.state))return refreshProgress(period);
    });
    progressRequests.current.set(period, request);
    return request;
  }, [commit]);
  return refreshProgress;
}

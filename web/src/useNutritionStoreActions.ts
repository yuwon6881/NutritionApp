import {validateFoodDestination} from './lib/foodDestination';
import {useMemo} from 'react';
import type {LocalData, PhysiqueDraft, BodyDraft} from './types';
import {saveLocalAndRetireFoodBasketDraft} from './lib/local';
import {queueEntries, type SyncKind} from './lib/nutritionDrafts';
import {resolveMutationConflicts} from './lib/mutationConflicts';

type Persist = (account: string, data: LocalData, previous: LocalData) => Promise<void>;
type Commit = (change: (data: LocalData) => LocalData, persist?: Persist) => Promise<void>;

/** Stable retained-work actions keep status changes out of action dependencies. */
export function useNutritionStoreActions(
  commit: Commit,
  markSyncQueued: (kind: SyncKind) => void,
  drain: () => Promise<void>,
  runPendingDrafts: () => Promise<void>
) {
  return useMemo(() => ({
    resolveConflicts: (ids:readonly string[])=>commit(current=>resolveMutationConflicts(current,ids)),
    logEntries: async (entries: unknown[], options?: {retireFoodBasketDate?: string;holdMs?:number}) => {
      const persist = options?.retireFoodBasketDate
        ? (account: string, data: LocalData, previous: LocalData) => saveLocalAndRetireFoodBasketDraft(account, data, options.retireFoodBasketDate!, previous)
        : undefined;
      let ids:string[]=[];
      await commit(current => {
        const queue=queueEntries(current,entries);
        const added=queue.slice(current.queue.length);
        const holdUntil=options?.holdMs?Date.now()+options.holdMs:undefined;
        added.forEach(op=>{validateFoodDestination(current.state,op);if(holdUntil)op.holdUntil=holdUntil;});
        ids=added.map(op=>op.id);
        return {...current,queue};
      },persist);
      markSyncQueued('entry');
      void drain();
      return ids;
    },
    addPhoto: async (draft: PhysiqueDraft) => {
      await commit(current => ({
        ...current,
        photoDrafts: [...(current.photoDrafts ?? []), {...draft,versionId:crypto.randomUUID()}]
      }));
      markSyncQueued('photo');
      void runPendingDrafts();
    },
    retryPhoto: async (id: string) => {
      await commit(current => ({
        ...current,
        photoDrafts: (current.photoDrafts ?? []).map(photo => (photo.versionId??photo.id) === id ? {
          ...photo,
          id: /expired|deleted/i.test(photo.error ?? '') ? crypto.randomUUID() : photo.id,
          error: undefined,retryAt:undefined
        } : photo)
      }));
      void runPendingDrafts();
    },
    removePhotoDraft: async (id: string) => commit(current => ({
      ...current, photoDrafts: (current.photoDrafts ?? []).filter(photo => (photo.versionId??photo.id) !== id)
    })),
    saveBodyDraft: async (draft: BodyDraft) => {
      await commit(current => {
        return {
          ...current,
          bodyDrafts:[...(current.bodyDrafts??[]),draft]
        };
      });
      markSyncQueued('body');
      await runPendingDrafts();
    },
    retryBody: async (id: string) => {
      await commit(current => ({
        ...current,
        bodyDrafts: (current.bodyDrafts ?? []).map(item => item.mutationId === id ? {...item, error: undefined,retryAt:undefined} : item)
      }));
      void runPendingDrafts();
    },
    removeBodyDraft: async (id: string) => commit(current => ({
      ...current, bodyDrafts: (current.bodyDrafts ?? []).filter(item => item.mutationId !== id)
    }))
  }), [commit, markSyncQueued, drain, runPendingDrafts]);
}

import {useMemo} from 'react';
import type {LocalData, PhysiqueDraft, BodyDraft} from './types';
import {saveLocalAndRetireFoodBasketDraft} from './lib/local';
import {queueEntries, type SyncKind} from './lib/nourishDrafts';

type Persist = (account: string, data: LocalData, previous: LocalData) => Promise<void>;
type Commit = (change: (data: LocalData) => LocalData, persist?: Persist) => Promise<void>;

/** Stable retained-work actions keep status changes out of action dependencies. */
export function useNourishActions(
  commit: Commit,
  markSyncQueued: (kind: SyncKind) => void,
  drain: () => Promise<void>,
  runPendingDrafts: () => Promise<void>
) {
  return useMemo(() => ({
    logEntries: async (entries: unknown[], options?: {retireFoodBasketDate?: string}) => {
      const persist = options?.retireFoodBasketDate
        ? (account: string, data: LocalData, previous: LocalData) => saveLocalAndRetireFoodBasketDraft(account, data, options.retireFoodBasketDate!, previous)
        : undefined;
      await commit(current => ({...current, queue: queueEntries(current, entries)}), persist);
      markSyncQueued('entry');
      void drain();
    },
    addPhoto: async (draft: PhysiqueDraft) => {
      await commit(current => ({
        ...current,
        photoDrafts: [...(current.photoDrafts ?? []).filter(photo => photo.id !== draft.id), draft]
      }));
      markSyncQueued('photo');
      void runPendingDrafts();
    },
    retryPhoto: async (id: string) => {
      await commit(current => ({
        ...current,
        photoDrafts: (current.photoDrafts ?? []).map(photo => photo.id === id ? {
          ...photo,
          id: /expired|deleted/i.test(photo.error ?? '') ? crypto.randomUUID() : photo.id,
          error: undefined
        } : photo)
      }));
      void runPendingDrafts();
    },
    removePhotoDraft: async (id: string) => commit(current => ({
      ...current, photoDrafts: (current.photoDrafts ?? []).filter(photo => photo.id !== id)
    })),
    saveBodyDraft: async (draft: BodyDraft) => {
      await commit(current => {
        const existing = current.bodyDrafts?.find(item => item.id === draft.id);
        return {
          ...current,
          bodyDrafts: existing
            ? (current.bodyDrafts ?? []).map(item => item.id === draft.id ? draft : item)
            : [...(current.bodyDrafts ?? []), draft]
        };
      });
      markSyncQueued('body');
      await runPendingDrafts();
    },
    retryBody: async (id: string) => {
      await commit(current => ({
        ...current,
        bodyDrafts: (current.bodyDrafts ?? []).map(item => item.id === id ? {...item, error: undefined} : item)
      }));
      void runPendingDrafts();
    },
    removeBodyDraft: async (id: string) => commit(current => ({
      ...current, bodyDrafts: (current.bodyDrafts ?? []).filter(item => item.id !== id)
    }))
  }), [commit, markSyncQueued, drain, runPendingDrafts]);
}

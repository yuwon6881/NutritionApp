import type {LocalData,PhysiqueDraft,BodyDraft} from '../types';
import {api,ApiError} from './api';
import {classifySyncFailure} from './syncFailure';
import {normalizePhotoDraft,type SyncKind} from './nutritionDrafts';

export interface UploadPendingDraftsOptions {
  isAlive: () => boolean;
  getDrafts: () => { photoDrafts?: PhysiqueDraft[]; bodyDrafts?: BodyDraft[] } | undefined;
  commit: (change: (data: LocalData) => LocalData) => Promise<void>;
  beginSync: (kind: SyncKind) => void;
  finishSync: () => void;
  setError: (msg: string) => void;
  expireSession: () => void;
}

export async function uploadPendingDrafts(options: UploadPendingDraftsOptions): Promise<void> {
  const { isAlive, getDrafts, commit, beginSync, finishSync, setError,expireSession } = options;
  const current = getDrafts();
  if (!current) return;
  const hasPhotoWork = (current.photoDrafts ?? []).some(draft => !draft.error);
  const hasBodyWork = (current.bodyDrafts ?? []).some(draft => !draft.error);
  if (!hasPhotoWork && !hasBodyWork) return;

  beginSync(hasBodyWork ? 'body' : 'photo');
  try {
    const blockedPhotos=new Set<string>();
    for (const draft of [...(getDrafts()?.photoDrafts ?? [])]) {
      if (!isAlive()) return;
      if(blockedPhotos.has(draft.id))continue;
      if(draft.error||(draft.retryAt??0)>Date.now()){blockedPhotos.add(draft.id);continue;}
      try {
        const normalized = normalizePhotoDraft(draft);
        const { error: _,retryAt:_retry,versionId:_version, ...input } = normalized;
        await api('/photos', input);
        await commit(c => ({ ...c, photoDrafts: (c.photoDrafts ?? []).filter(p => (p.versionId??p.id) !== (draft.versionId??draft.id)) }));
        if(typeof window!=='undefined')window.dispatchEvent(new Event('nutrition:body-saved'));
      } catch (ex) {
        blockedPhotos.add(draft.id);
        const failure=classifySyncFailure(ex);
        if(failure==='session-expired'){expireSession();return;}
        await commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).map(item=>(item.versionId??item.id)===(draft.versionId??draft.id)
          ?{...item,...(failure==='rejected'?{error:(ex as Error).message}:{retryAt:Date.now()+(ex instanceof ApiError?ex.retryAfterMs??5000:5000)})}:item)}));
        if(failure==='retry')setError('Photo is retained and will retry when connected.');
      }
    }
    const blocked=new Set<string>();
    for (const queued of [...(getDrafts()?.bodyDrafts ?? [])]) {
      const draft=getDrafts()?.bodyDrafts?.find(item=>item.mutationId===queued.mutationId);
      if(!draft)continue;
      if (!isAlive()) return;
      if(blocked.has(draft.id))continue;
      if(draft.error || (draft.retryAt??0)>Date.now()){blocked.add(draft.id);continue;}
      try {
        const {dispatchBodyDraft}=await import('./bodyDraftDispatch');
        await dispatchBodyDraft(draft,commit,isAlive);
      } catch (ex) {
        blocked.add(draft.id);
        const failure=classifySyncFailure(ex);
        if(failure==='session-expired'){expireSession();return;}
        const review=failure==='rejected'||!(ex instanceof ApiError)&&ex instanceof Error&&ex.message.startsWith('This older partial');
        await commit(c=>({...c,bodyDrafts:(c.bodyDrafts??[]).map(item=>item.mutationId===draft.mutationId
          ?{...item,...(review?{error:(ex as Error).message}:{retryAt:Date.now()+(ex instanceof ApiError?ex.retryAfterMs??5000:5000)})}:item)}));
        if(!review)setError('Body record is retained and will retry when connected.');
      }
    }
  } finally {
    finishSync();
  }
}

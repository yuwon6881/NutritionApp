import type { BodyDraft, LocalData, Mutation, PhysiqueAngle, PhysiqueDraft } from '../types';
import { api, ApiError } from './api';

export type SyncKind = Mutation['kind'] | 'photo' | 'body';
export type SyncPhase = 'idle' | 'queued' | 'syncing' | 'synced';
export type SyncState = { phase: SyncPhase; kind?: SyncKind };

export function queueEntries(current: LocalData, entries: unknown[]): Mutation[] {
  return [
    ...current.queue,
    ...entries.map(data => ({
      id: crypto.randomUUID(),
      kind: 'entry' as const,
      recordId: crypto.randomUUID(),
      expectedRevision: 0,
      data,
      delete: false
    }))
  ];
}

export function normalizePhotoDraft(value: PhysiqueDraft): PhysiqueDraft {
  const legacy = value as PhysiqueDraft & { angle?: string; imageBase64?: string };
  if (Array.isArray(value.photos)) return value;
  const angle = (legacy.angle === 'side' || legacy.angle === 'back') ? legacy.angle as PhysiqueAngle : 'front';
  return { id: value.id, date: value.date, photos: legacy.imageBase64 ? [{ id: value.id, angle, imageBase64: legacy.imageBase64 }] : [] };
}

export interface UploadPendingDraftsOptions {
  isAlive: () => boolean;
  getDrafts: () => { photoDrafts?: PhysiqueDraft[]; bodyDrafts?: BodyDraft[] } | undefined;
  commit: (change: (data: LocalData) => LocalData) => Promise<void>;
  beginSync: (kind: SyncKind) => void;
  finishSync: () => void;
  setError: (msg: string) => void;
}

export async function uploadPendingDrafts(options: UploadPendingDraftsOptions): Promise<void> {
  const { isAlive, getDrafts, commit, beginSync, finishSync, setError } = options;
  const current = getDrafts();
  if (!current) return;
  const hasPhotoWork = (current.photoDrafts ?? []).some(draft => !draft.error);
  const hasBodyWork = (current.bodyDrafts ?? []).some(draft => !draft.error);
  if (!hasPhotoWork && !hasBodyWork) return;

  beginSync(hasBodyWork ? 'body' : 'photo');
  try {
    for (const draft of [...(getDrafts()?.photoDrafts ?? [])]) {
      if (!isAlive() || draft.error) continue;
      try {
        const normalized = normalizePhotoDraft(draft);
        const { error: _, ...input } = normalized;
        await api('/photos', input);
        await commit(c => ({ ...c, photoDrafts: (c.photoDrafts ?? []).filter(p => p.id !== draft.id) }));
      } catch (ex) {
        if (ex instanceof ApiError) await commit(c => ({ ...c, photoDrafts: (c.photoDrafts ?? []).map(p => p.id === draft.id ? { ...p, error: ex.message } : p) }));
        else setError('Photo is retained and will retry when connected.');
      }
    }
    for (const draft of [...(getDrafts()?.bodyDrafts ?? [])]) {
      if (!isAlive() || draft.error) continue;
      try {
        type BodyResponse = { id: string; revision: number };
        const action = draft.action ?? 'save';
        const body = draft.serverRevision != null ? { id: draft.id, revision: draft.serverRevision } : await api<BodyResponse>('/body-records/' + draft.id, {
          id: draft.mutationId, expectedRevision: draft.expectedRevision, action,
          ...(action === 'save' ? { data: { date: draft.date, measurements: draft.measurements, photos: draft.photos.map(photo => ({ id: photo.id, angle: photo.angle })), weightContext: draft.weightContext, omitScale: draft.omitScale ?? false, omitTrend: draft.omitTrend ?? false } } : {})
        });
        await commit(c => ({ ...c, bodyDrafts: (c.bodyDrafts ?? []).map(item => item.id === draft.id ? { ...item, serverRevision: body.revision, expectedRevision: body.revision, error: undefined } : item) }));
        let revision = body.revision;
        if (draft.photos.length) {
          const photoMutationId = draft.photoMutationId ?? crypto.randomUUID();
          if (!draft.photoMutationId) await commit(c => ({ ...c, bodyDrafts: (c.bodyDrafts ?? []).map(item => item.id === draft.id ? { ...item, photoMutationId } : item) }));
          const uploaded = await api<{ revision: number }>('/body-records/' + draft.id + '/photos', {
            id: draft.id, date: draft.date, photos: draft.photos, mutationId: photoMutationId, expectedRevision: revision
          });
          revision = uploaded.revision;
        }
        for (const photoId of draft.deletePhotoIds ?? []) {
          const mutationId = draft.deleteMutationIds?.[photoId] ?? crypto.randomUUID();
          if (!draft.deleteMutationIds?.[photoId]) await commit(c => ({ ...c, bodyDrafts: (c.bodyDrafts ?? []).map(item => item.id === draft.id ? { ...item, deleteMutationIds: { ...(item.deleteMutationIds ?? {}), [photoId]: mutationId } } : item) }));
          const deleted = await api<{ revision: number }>('/body-records/' + draft.id, {
            id: mutationId, expectedRevision: revision, action: 'photo-delete', photoId
          });
          revision = deleted.revision;
        }
        await commit(c => ({ ...c, bodyDrafts: (c.bodyDrafts ?? []).filter(item => item.id !== draft.id) }));
      } catch (ex) {
        if (ex instanceof ApiError) await commit(c => ({ ...c, bodyDrafts: (c.bodyDrafts ?? []).map(item => item.id === draft.id ? { ...item, error: ex.message } : item) }));
        else setError('Body record is retained and will retry when connected.');
      }
    }
  } finally {
    finishSync();
  }
}

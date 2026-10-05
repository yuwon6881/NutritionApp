import type { BodyDraft, LocalData, Mutation, PhysiqueAngle, PhysiqueDraft } from '../types';

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

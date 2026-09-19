import type { LocalData } from '../types';
import { apiWithMeta } from './api';
import { today } from './format';

type Ref<T> = { current: T };
export type NutritionRevisions = {
  account: number; profile: number; settings: number; trajectory: number; foods: number; diary: number; body: number;
  training: number; google: number; localDay: string; detailDays: number;
};

export async function pollNutritionRevisions(
  user: string,
  local: Ref<LocalData | undefined>,
  etag: Ref<string | undefined>,
  lastPeerRefresh: Ref<number>,
  refresh: () => Promise<void>,
  loadSavedFoods: () => Promise<void>,
  loadTrainingSummaries: () => Promise<void>
) {
  if (!user || !navigator.onLine || !local.current) return;
  const response = await apiWithMeta<NutritionRevisions>('/revisions', { headers: etag.current ? { 'If-None-Match': etag.current } : undefined });
  if (response.etag) etag.current = response.etag;
  if (response.data) {
    const current = local.current.state;
    const revision = response.data;
    const bootstrapChanged = current.diaryRevision == null || current.trajectoryRevision == null || current.bodyRevision == null ||
      revision.profile !== current.profileRevision || revision.settings !== (current.settings?.revision ?? 0) ||
      revision.diary !== current.diaryRevision || revision.trajectory !== current.trajectoryRevision ||
      revision.localDay !== today(current.profile?.timeZone);
    if (bootstrapChanged) await refresh();
    if (revision.foods !== (current.foodRevision ?? current.revision)) await loadSavedFoods();
  }
  // Peer data has its own provider freshness contract, independent of local revision equality.
  if (Date.now() - lastPeerRefresh.current >= 120_000) await loadTrainingSummaries();
}

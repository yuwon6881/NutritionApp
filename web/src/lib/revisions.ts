import type { LocalData } from '../types';
import { apiWithMeta } from './api';
import { today } from './format';

type Ref<T> = { current: T };
export type NutritionRevisions = {
  account: number; profile: number; settings: number; trajectory: number; foods: number; diary: number; body: number;
  training: number; google: number; localDay: string; detailDays: number;
};

export function bootstrapNeedsRefresh(state: LocalData['state'], revision: NutritionRevisions): boolean {
  return revision.account !== state.revision || state.diaryRevision == null || state.trajectoryRevision == null || state.bodyRevision == null ||
    revision.profile !== state.profileRevision || revision.settings !== (state.settings?.revision ?? 0) ||
    revision.diary !== state.diaryRevision || revision.trajectory !== state.trajectoryRevision ||
    revision.localDay !== today(state.profile?.timeZone);
}

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
    if (bootstrapNeedsRefresh(current, revision)) await refresh();
    if (revision.foods !== (current.foodRevision ?? current.revision)) await loadSavedFoods();
  }
  // Peer data has its own provider freshness contract, independent of local revision equality.
  if (Date.now() - lastPeerRefresh.current >= 120_000) await loadTrainingSummaries();
}

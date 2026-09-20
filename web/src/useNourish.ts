import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, BootstrapResponse, DatedDiaryDay, Day, Entry, Food, LocalData, Mutation, PhysiqueAngle, PhysiqueDraft, ProgressSummary, BodyDraft, TrainingSummary } from './types';
import { api, apiWithMeta, ApiError } from './lib/api';
import { readLocal, saveLocal, readSavedFoods, saveSavedFoods, saveDatedDiaryBatch, stripLegacyScanDrafts } from './lib/local';
import {isSavedFoodsCacheUsable} from './lib/savedFoods';
import { today } from './lib/format';
import { enqueueMutation, project, rebaseAfterOwnWrite, wireMutation } from './lib/projection';
import { acknowledgeHistory } from './lib/history';
import { sharedDiaryCoordinator } from './lib/diaryCoordinator';
import { pollNutritionRevisions } from './lib/revisions';
export type SyncKind = Mutation['kind'] | 'photo' | 'body';
export type SyncPhase = 'idle' | 'queued' | 'syncing' | 'synced';
export type SyncState = { phase: SyncPhase; kind?: SyncKind };
function queueEntries(current: LocalData, entries: unknown[]): Mutation[] {
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
function normalizePhotoDraft(value: PhysiqueDraft): PhysiqueDraft {
  const legacy = value as PhysiqueDraft & { angle?: string; imageBase64?: string };
  if (Array.isArray(value.photos)) return value;
  const angle = (legacy.angle === 'side' || legacy.angle === 'back') ? legacy.angle as PhysiqueAngle : 'front';
  return { id: value.id, date: value.date, photos: legacy.imageBase64 ? [{ id: value.id, angle, imageBase64: legacy.imageBase64 }] : [] };
}
export function useNourish(user: string) {
  const [calendarDate, setCalendarDate] = useState(today());
  const [local, setLocal] = useState<LocalData>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<SyncState>({ phase: 'idle' });
  const ref = useRef<LocalData | undefined>(undefined);
  const writes = useRef(Promise.resolve());
  const draining = useRef(false);
  const processingDrafts = useRef(false);
  const alive = useRef(true);
  const drainRequested = useRef(false);
  const windowDate = useRef<string | undefined>(undefined);
  const refreshSequence = useRef(0);
  const bootstrapEtag = useRef<string | undefined>(undefined);
  const foodsEtag = useRef<string | undefined>(undefined);
  const trainingEtag = useRef<string | undefined>(undefined);
  const revisionsEtag = useRef<string | undefined>(undefined);
  const lastPeerRefresh = useRef(0);
  const progressSequences = useRef(new Map<string, number>());
  const progressRequests = useRef(new Map<string, Promise<void>>());
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeSync = useRef(0);
  const syncStartedAt = useRef<number | undefined>(undefined);
  const activeOperations = useRef(new Set<string>());
  const [isActivityActive, setIsActivityActive] = useState(false);
  const isActivityActiveRef = useRef(false);
  const activityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastWake = useRef(0);
  const checkActivity = useCallback(() => {
    const hasWork = activeOperations.current.size > 0 || activeSync.current > 0;
    if (hasWork) {
      if (activityTimer.current === undefined && !isActivityActiveRef.current) {
        activityTimer.current = setTimeout(() => {
          activityTimer.current = undefined;
          if (!alive.current) return;
          if (activeOperations.current.size > 0 || activeSync.current > 0) {
            isActivityActiveRef.current = true;
            setIsActivityActive(true);
          }
        }, 300);
      }
    } else {
      if (activityTimer.current !== undefined) {
        clearTimeout(activityTimer.current);
        activityTimer.current = undefined;
      }
      if (isActivityActiveRef.current) {
        isActivityActiveRef.current = false;
        setIsActivityActive(false);
      }
    }
  }, []);
  const beginActivity = useCallback((id: string) => {
    activeOperations.current.add(id);
    checkActivity();
    return () => {
      activeOperations.current.delete(id);
      checkActivity();
    };
  }, [checkActivity]);
  const clearSyncTimer = useCallback(() => {
    if (syncTimer.current !== undefined) {
      clearTimeout(syncTimer.current);
      syncTimer.current = undefined;
    }
  }, []);
  const markSyncQueued = useCallback((kind: SyncKind) => {
    if (activeSync.current) return;
    clearSyncTimer();
    setSync({ phase: 'queued', kind });
  }, [clearSyncTimer]);
  const beginSync = useCallback((kind: SyncKind) => {
    if (activeSync.current === 0) {
      clearSyncTimer();
      syncStartedAt.current = Date.now();
      setSync({ phase: 'syncing', kind });
    }
    activeSync.current += 1;
    checkActivity();
  }, [checkActivity, clearSyncTimer]);
  const finishSync = useCallback(() => {
    if (activeSync.current === 0) return;
    activeSync.current -= 1;
    checkActivity();
    if (activeSync.current) return;
    clearSyncTimer();
    if (alive.current) setSync({ phase: 'idle' });
  }, [checkActivity, clearSyncTimer]);
  const commit = useCallback(async (change: (data: LocalData) => LocalData) => {
    const task = writes.current.catch(() => {}).then(async () => {
      if (!alive.current || !ref.current) return;
      const next = change(ref.current);
      if (next === ref.current) return;
      await saveLocal(user, next);
      if (!alive.current) return;
      ref.current = next;
      setLocal(next);
    });
    writes.current = task;
    return task;
  }, [user]);
  const refresh = useCallback(async (date?: string) => {
    const endActivity = beginActivity('refresh');
    try {
      if (date !== undefined) windowDate.current = date === 'recent' ? undefined : date;
      const selected = windowDate.current;
      const sequence = ++refreshSequence.current;
      let state: AppState | null = null;
      let foodsLoaded=false;
      if (!selected) {
        try {
          const bRes = await apiWithMeta<BootstrapResponse>('/bootstrap', {
            headers: bootstrapEtag.current ? { 'If-None-Match': bootstrapEtag.current } : undefined
          });
          if (bRes.etag) bootstrapEtag.current = bRes.etag;
          if (bRes.notModified) {
            // A validator hit means the local bootstrap remains authoritative. Do not
            // issue the compatibility /state request or rebuild the same payload.
            state = ref.current?.state ?? null;
            foodsLoaded=ref.current?.foodsLoaded??false;
          }
          if (bRes.data) {
            const b = bRes.data;
            if (b.id !== user) throw new Error('The signed-in account changed. Sign in again.');
            lastPeerRefresh.current = Date.now();
            const byDate = new Map<string, { entries: Entry[]; day?: Day }>();
            for (const e of b.entries ?? []) {
              let bucket = byDate.get(e.date);
              if (!bucket) { bucket = { entries: [] }; byDate.set(e.date, bucket); }
              bucket.entries.push(e);
            }
            for (const d of b.days ?? []) {
              let bucket = byDate.get(d.date);
              if (!bucket) { bucket = { entries: [] }; byDate.set(d.date, bucket); }
              bucket.day = d;
            }
            const now = Date.now();
            const datedDays: DatedDiaryDay[] = [...byDate.entries()].map(([dStr, bucket]) => ({
              date: dStr,
              entries: bucket.entries.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.id.localeCompare(b.id)),
              day: bucket.day,
              revision: b.revision,
              fetchedAt: now
            }));
            sharedDiaryCoordinator.primeDays(datedDays);
            void saveDatedDiaryBatch(user, datedDays);
            const cachedFoods = await readSavedFoods(user);
            foodsLoaded=isSavedFoodsCacheUsable(cachedFoods,b.foodRevision??b.revision);
            state = { ...b, foods: cachedFoods?.foods ?? ref.current?.state.foods ?? [], trainingSummaries: ref.current?.state.trainingSummaries ?? [] };
          }
        } catch (ex) {
          // /state is a compatibility path for a server that predates bootstrap.
          // Do not turn authentication, provider, server, or network failures into a
          // second full-state request: that doubles load precisely when the first
          // request already established that the session or service is unhealthy.
          if (!(ex instanceof ApiError) || ![404, 405].includes(ex.status)) throw ex;
        }
      }
      if (!state) {
        state = await api<AppState>('/state' + (selected ? (selected.length === 4 ? '?year=' : '?date=') + selected : ''));
        foodsLoaded=true;
      }
      if (!alive.current || sequence !== refreshSequence.current || !state) return;
      if (state.id !== user) throw new Error('The signed-in account changed. Sign in again.');
      if (!ref.current) {
        const data: LocalData = { state, queue: [], foodsLoaded };
        await saveLocal(user, data);
        if (alive.current) { ref.current = data; setLocal(data); }
      } else {
        await commit(current => {
          if (state!.revision < current.state.revision || JSON.stringify(state) === JSON.stringify(current.state)) return current;
          const foods = state!.foods ?? (current.state.foods ?? []);
          const trainingSummaries = state!.trainingSummaries ?? (current.state.trainingSummaries ?? []);
          return { ...current, state: { ...state!, foods, trainingSummaries }, foodsLoaded };
        });
      }
    } finally {
      endActivity();
    }
  }, [beginActivity, commit, user]);
  const refreshHistory = useCallback(async (key: string) => {
    const todayDate = today(ref.current?.state.profile?.timeZone);
    await sharedDiaryCoordinator.requestDate(key, todayDate, { isNavigation: true });
  }, []);
  const loadSavedFoods = useCallback(async () => {
    if (!user) return;
    const cached = await readSavedFoods(user);
    if (cached && ref.current && (!ref.current.state.foods || !ref.current.state.foods.length)) {
      const cacheLoaded=cached.loaded===true||cached.foods.length>0||cached.revision===0;
      await commit(current => ({ ...current, state: { ...current.state, foods: cached.foods }, foodsLoaded: cacheLoaded }));
    }
    const currentFoodRevision = ref.current?.state.foodRevision ?? ref.current?.state.revision ?? 0;
    if (isSavedFoodsCacheUsable(cached,currentFoodRevision)||!navigator.onLine) return;
    try {
      const res = await apiWithMeta<{ foods: Food[]; revision: number; foodRevision?: number }>('/foods', {
        headers: foodsEtag.current ? { 'If-None-Match': foodsEtag.current } : undefined
      });
      if (res.etag) foodsEtag.current = res.etag;
      if (res.notModified) return;
      if (res.data?.foods && alive.current) {
        await saveSavedFoods(user, res.data.foods, res.data.foodRevision ?? res.data.revision);
        await commit(current => ({ ...current, state: { ...current.state, foods: res.data!.foods, foodRevision: res.data!.foodRevision ?? res.data!.revision }, foodsLoaded:true }));
      }
    } catch { /* retain cached foods */ }
  }, [commit, user]);
  const loadTrainingSummaries = useCallback(async () => {
    if (!user || !navigator.onLine) return;
    try {
      const res = await apiWithMeta<{ summaries: TrainingSummary[]; workoutConnected?: boolean; workoutWarning?: string | null }>('/training/summary', {
        headers: trainingEtag.current ? { 'If-None-Match': trainingEtag.current } : undefined
      });
      if (res.etag) trainingEtag.current = res.etag;
      lastPeerRefresh.current = Date.now();
      if (res.data && alive.current) {
        await commit(current => ({ ...current, state: { ...current.state, trainingSummaries: res.data!.summaries, workoutConnected: res.data!.workoutConnected, workoutWarning: res.data!.workoutWarning } }));
      }
    } catch { /* retain existing workout state */ }
  }, [commit, user]);
  const pollRevisions = useCallback(() => pollNutritionRevisions(user, ref, revisionsEtag, lastPeerRefresh, refresh, loadSavedFoods, loadTrainingSummaries).catch(() => undefined),
    [loadSavedFoods, loadTrainingSummaries, refresh, user]);
  const refreshProgress = useCallback((period: string) => {
    const running = progressRequests.current.get(period);
    if (running) return running;
    const sequence = (progressSequences.current.get(period) ?? 0) + 1;
    progressSequences.current.set(period, sequence);
    const request = (async () => {
      const summary = await api<ProgressSummary>('/progress/summary?period=' + encodeURIComponent(period));
      if (!alive.current || progressSequences.current.get(period) !== sequence) return;
      await commit(current => {
        const previous = current.progress?.[period];
        if (previous && summary.revision < previous.revision) return current;
        return { ...current, progress: { ...(current.progress ?? {}), [period]: summary } };
      });
    })().finally(() => { progressRequests.current.delete(period); });
    progressRequests.current.set(period, request);
    return request;
  }, [commit]);
  const drain = useCallback(async () => {
    if (draining.current || !navigator.onLine || !ref.current) return;
    const hadQueue = ref.current.queue.length > 0;
    draining.current = true;
    if (ref.current.queue.length) { beginSync(ref.current.queue[0]?.kind ?? 'entry'); setBusy(true); }
    try {
      while (alive.current && ref.current?.queue.length) {
        const op = ref.current.queue[0];
        if (op.error) break;
        try {
          const { revision } = await api<{ revision: number }>('/sync', wireMutation(op));
          await commit(current => {
            const state = project(current.state, [op]);
            state.revision = revision;
            if (op.kind === 'profile') state.profileRevision = revision;
            else if (op.kind === 'settings') { if (state.settings) state.settings.revision = revision; }
            else {
              const key = { entry: 'entries', food: 'foods', weight: 'weights', day: 'days' }[op.kind] as 'entries' | 'foods' | 'weights' | 'days';
              const item = state[key].find(r => r.id === op.recordId);
              if (item) item.revision = revision;
            }
            const queue = rebaseAfterOwnWrite(current.queue, op, revision);
            if (op.kind === 'entry') {
              const date = (op.data as { date?: string }).date;
              for (const day of state.days) {
                if (day.date === date) {
                  day.revision = revision;
                  for (const q of queue) if (q.kind === 'day' && q.recordId === day.id) q.expectedRevision = revision;
                }
              }
            }
            const history = Object.fromEntries(Object.entries(current.history ?? {}).map(([k, saved]) => [k, acknowledgeHistory(saved, op, revision)]));
            return { ...current, state, queue, history, foodsLoaded: op.kind==='food'?true:current.foodsLoaded };
          });
        } catch (ex) {
          if (ex instanceof ApiError && [400, 409, 422].includes(ex.status)) {
            await commit(current => ({ ...current, queue: current.queue.map(q => q.id === op.id ? { ...q, error: ex.message } : q) }));
          }
          throw ex;
        }
      }
      // A refresh is needed only when at least one operation was actually sent.
      // Empty drains are common on visibility/online wakes and should not repeat
      // the full bootstrap read.
      if (alive.current && hadQueue) await refresh();
      setError('');
    } catch (ex) {
      if (alive.current) setError(ex instanceof Error ? ex.message : 'Sync is waiting for a connection.');
    } finally {
      draining.current = false;
      if (alive.current) {
        setBusy(false);
        finishSync();
        if (drainRequested.current) { drainRequested.current = false; void drain(); }
      }
    }
  }, [beginSync, commit, finishSync, refresh]);

  const mutate = useCallback(async (op: Omit<Mutation, 'id'>) => {
    const fullOp: Mutation = { ...op, id: crypto.randomUUID() };
    await commit(current => enqueueMutation(current,fullOp));
    if (op.kind === 'entry') {
      const entryData = op.data as any;
      if (entryData?.date) sharedDiaryCoordinator.projectDate(entryData.date, [fullOp]);
    }
    markSyncQueued(op.kind);
    if (draining.current) drainRequested.current = true; else void drain();
  }, [commit, drain, markSyncQueued]);

  const runPendingDrafts = useCallback(async () => {
    if (processingDrafts.current || !navigator.onLine || !ref.current) return;
    processingDrafts.current = true;
    const hasPhotoWork = (ref.current.photoDrafts ?? []).some(draft => !draft.error);
    const hasBodyWork = (ref.current.bodyDrafts ?? []).some(draft => !draft.error);
    if (!hasPhotoWork && !hasBodyWork) { processingDrafts.current = false; return; }
    beginSync(hasBodyWork ? 'body' : 'photo');
    try {
      for (const draft of [...(ref.current.photoDrafts ?? [])]) {
        if (!alive.current || draft.error) continue;
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
      for (const draft of [...(ref.current.bodyDrafts ?? [])]) {
        if (!alive.current || draft.error) continue;
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
    } finally { processingDrafts.current = false; finishSync(); }
  }, [beginSync, commit, finishSync]);

  useEffect(() => {
    sharedDiaryCoordinator.setUser(user);
    // Validators are account-scoped. Drop them before loading another account so a
    // same-number revision can never reuse a previous account's 304 response.
    bootstrapEtag.current = undefined;
    foodsEtag.current = undefined;
    trainingEtag.current = undefined;
    revisionsEtag.current = undefined;
    lastPeerRefresh.current = 0;
    alive.current = true;
    void (async () => {
      try {
        const cached = await readLocal(user);
        const normalized = cached ? stripLegacyScanDrafts(cached) : undefined;
        if (normalized && alive.current) {
          if (normalized !== cached) await saveLocal(user, normalized);
          ref.current = normalized;
          setLocal(normalized);

          const byDate = new Map<string, { entries: Entry[]; day?: Day }>();
          for (const e of normalized.state.entries ?? []) {
            let b = byDate.get(e.date);
            if (!b) { b = { entries: [] }; byDate.set(e.date, b); }
            b.entries.push(e);
          }
          for (const d of normalized.state.days ?? []) {
            let b = byDate.get(d.date);
            if (!b) { b = { entries: [] }; byDate.set(d.date, b); }
            b.day = d;
          }
          const datedDays: DatedDiaryDay[] = [...byDate.entries()].map(([dStr, b]) => ({
            date: dStr, entries: b.entries, day: b.day, revision: normalized.state.revision, fetchedAt: Date.now()
          }));
          sharedDiaryCoordinator.primeDays(datedDays);
        }
        await refresh();
        if (ref.current?.queue.length) await drain();
        await runPendingDrafts();
        void loadSavedFoods();
      } catch (ex) {
        if (alive.current) setError(ex instanceof Error ? ex.message : 'Could not load diary.');
      }
    })();

    const wake = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastWake.current < 2000) return;
        lastWake.current = now;
        setCalendarDate(today(ref.current?.state.profile?.timeZone));
        const hadQueue = Boolean(ref.current?.queue.length);
        void (async () => {
          await drain();
          // drain refreshes after successful queued writes. A clean wake still
          // needs one conditional foreground refresh.
          if (!hadQueue && alive.current) await pollRevisions();
        })();
        void runPendingDrafts();
      }
    };

    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);

    let heartbeat = Date.now();
    const retained = () => Boolean(ref.current && (ref.current.queue.length || ref.current.photoDrafts?.length || ref.current.bodyDrafts?.length));
    const interval = window.setInterval(() => {
      if (retained() || Date.now() - heartbeat >= 30000) {
        heartbeat = Date.now();
        wake();
      }
    }, 10000);

    return () => {
      alive.current = false;
      sharedDiaryCoordinator.reset();
      clearSyncTimer();
      if (activityTimer.current !== undefined) clearTimeout(activityTimer.current);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      clearInterval(interval);
    };
  }, [user, refresh, refreshProgress, drain, runPendingDrafts, pollRevisions]);

  const state = useMemo(() => local ? project(local.state, local.queue) : undefined, [local]);

  return {
    state, local, error, busy, sync, isActivityActive, beginActivity, mutate, refresh, refreshHistory, refreshProgress, loadSavedFoods, loadTrainingSummaries, drain, calendarDate,
    logEntries: async (entries: unknown[]) => {
      await commit(current => ({ ...current, queue: queueEntries(current, entries) }));
      markSyncQueued('entry');
      void drain();
    },
    discardConflict: async (id: string) => { await commit(c => ({ ...c, queue: c.queue.filter(q => q.id !== id) })); await drain(); },
    addPhoto: async (draft: PhysiqueDraft) => { await commit(c => ({ ...c, photoDrafts: [...(c.photoDrafts ?? []).filter(p => p.id !== draft.id), draft] })); markSyncQueued('photo'); void runPendingDrafts(); },
    retryPhoto: async (id: string) => { await commit(c => ({ ...c, photoDrafts: (c.photoDrafts ?? []).map(p => p.id === id ? { ...p, id: /expired|deleted/i.test(p.error ?? '') ? crypto.randomUUID() : p.id, error: undefined } : p) })); void runPendingDrafts(); },
    removePhotoDraft: async (id: string) => commit(c => ({ ...c, photoDrafts: (c.photoDrafts ?? []).filter(p => p.id !== id) })),
    saveBodyDraft: async (draft: BodyDraft) => { await commit(c => { const existing = c.bodyDrafts?.find(i => i.id === draft.id); return { ...c, bodyDrafts: existing ? (c.bodyDrafts ?? []).map(i => i.id === draft.id ? draft : i) : [...(c.bodyDrafts ?? []), draft] }; }); markSyncQueued('body'); await runPendingDrafts(); },
    retryBody: async (id: string) => { await commit(c => ({ ...c, bodyDrafts: (c.bodyDrafts ?? []).map(i => i.id === id ? { ...i, error: undefined } : i) })); void runPendingDrafts(); },
    removeBodyDraft: async (id: string) => commit(c => ({ ...c, bodyDrafts: (c.bodyDrafts ?? []).filter(i => i.id !== id) })),
  };
}

export type Nourish = ReturnType<typeof useNourish>;

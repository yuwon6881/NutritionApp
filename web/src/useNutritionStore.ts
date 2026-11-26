import {validateFoodDestination} from './lib/foodDestination';
import { beginIntegrationBurst } from './lib/integrationDispatch';
import {acquireAccountDispatch,subscribeAccountWork} from './lib/accountWork';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, BootstrapResponse, LocalData, Mutation } from './types';
import { api, apiWithMeta, ApiError } from './lib/api';
import { saveLocal, readLocal, readSavedFoods, stripLegacyScanDrafts } from './lib/local';
import {reloadRetainedWork} from './lib/retainedReload';
import {isSavedFoodsCacheUsable} from './lib/savedFoods';
import {useSavedFoods} from './useSavedFoods';
import { today } from './lib/format';
import { enqueueMutation, project } from './lib/projection';
import { releaseHeldMutations, undoHeldMutations } from './lib/heldMutations';
import { sharedDiaryCoordinator } from './lib/diaryCoordinator';
import { pollNutritionRevisions } from './lib/revisions';
import { type SyncKind, type SyncPhase, type SyncState } from './lib/nutritionDrafts';
import {hydrateAccount,clearAccountHydration,getHydratedAccount} from './lib/accountHydration';
import {measurePerformance} from './lib/performance';
import {singleFlight} from './lib/singleFlight';
import {useTrainingSummaries} from './useTrainingSummaries';
import {trainingWarning} from './lib/trainingFreshness';
import {useNutritionStoreActions} from './useNutritionStoreActions';
import {useFoodFavourite} from './useFoodFavourite';
import {useProgressReads} from './useProgressReads';
import { flushBackgroundOutbox, reconcileNativeOutbox, registerOutboxBackgroundSync, subscribeNativeBackgroundLifecycle, syncNativeBackgroundOutbox } from './lib/outboxBackground';
import { runOutboxDrainLoop } from './lib/outboxDrain';
import { dismissToast, showNotice } from './components/ui/UndoToast';
import {classifySyncFailure} from './lib/syncFailure';
export type { SyncKind, SyncPhase, SyncState };

export function useNutritionStore(user: string, onSessionExpired?: () => void, authReady=true) {
  const dispatchAllowed=useRef(authReady);
  dispatchAllowed.current=authReady;
  const [calendarDate, setCalendarDate] = useState(today());
  // A finished startup read seeds the first render so a returning account never flashes the skeleton.
  const [initial]=useState(()=>{const hydrated=getHydratedAccount(user);return hydrated?stripLegacyScanDrafts(hydrated):undefined;});
  const [local, setLocal] = useState<LocalData|undefined>(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendingRecordId, setSendingRecordId] = useState<string | undefined>(); // on the wire now; queued work waits
  const [sync, setSync] = useState<SyncState>({ phase: 'idle' });
  const ref = useRef<LocalData | undefined>(initial);
  const writes = useRef(Promise.resolve());
  const draining = useRef(false);
  const inFlightKeepalive = useRef(new Map<string, Promise<void>>());
  const processingDrafts = useRef(false);
  const alive = useRef(true);
  const drainRequested = useRef(false);
  const draftsRequested=useRef(false);
  const heldDrainTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const windowDate = useRef<string | undefined>(undefined);
  const refreshSequence = useRef(0);
  const bootstrapEtag = useRef<string | undefined>(undefined);
  const foodsEtag = useRef<string | undefined>(undefined);
  const revisionsEtag = useRef<string | undefined>(undefined);
  const lastPeerRefresh = useRef(0);
  const refreshRequests = useRef(new Map<string,Promise<void>>());
  const revisionRequests = useRef(new Map<string,Promise<void>>());
  const readController = useRef(new AbortController());
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeSync = useRef(0);
  const syncStartedAt = useRef<number | undefined>(undefined);
  const activeOperations = useRef(new Set<string>());
  const [isActivityActive, setIsActivityActive] = useState(false);
  const isActivityActiveRef = useRef(false);
  const activityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastWake = useRef(0);
  // Once the server rejects the session, nothing is sent until the user signs in again; the queue stays saved.
  const sessionExpired = useRef(false);
  const sessionExpiredHandler = useRef(onSessionExpired);
  sessionExpiredHandler.current = onSessionExpired;
  const expireSession = useCallback(() => {
    if (sessionExpired.current) return;
    sessionExpired.current = true;
    sessionExpiredHandler.current?.();
  }, []);
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
  const commit = useCallback(async (change: (data: LocalData) => LocalData, persist?: (account: string, data: LocalData, previous: LocalData) => Promise<void>) => {
    const finish=measurePerformance('local.save');
    const task = writes.current.catch(() => {}).then(async () => {
      if (!alive.current || !ref.current) return;
      const previous = ref.current;
      const next = change(previous);
      if (next === previous) return;
      await (persist ? persist(user, next, previous) : saveLocal(user, next, previous));
      if (!alive.current) return;
      ref.current = next;
      setLocal(next);
      if (next.queue !== previous.queue) {
        syncNativeBackgroundOutbox(user, next.queue, false);
        if (next.queue.length) registerOutboxBackgroundSync();
      }
    });
    writes.current = task;
    try{await task;}finally{finish();}
  }, [user]);
  const {loadTrainingSummaries,trainingLoading,trainingError,trainingResolved,trainingLiveAccount}=useTrainingSummaries(user,ref,alive,readController,commit,lastPeerRefresh);
  const refresh = useCallback((date?: string) => {
    if (date !== undefined) windowDate.current = date === 'recent' ? undefined : date;
    return singleFlight(refreshRequests.current,windowDate.current??'bootstrap',async()=>{
    const endActivity = beginActivity('refresh');
    try {
      const selected = windowDate.current;
      const sequence = ++refreshSequence.current;
      let state: AppState | null = null;
      let foodsLoaded=false;
      let receivedEtag:string|undefined;
      if(selected)bootstrapEtag.current=undefined;
      if (!selected) {
        try {
          const bRes = await apiWithMeta<BootstrapResponse>('/bootstrap', {
            headers: bootstrapEtag.current ? { 'If-None-Match': bootstrapEtag.current } : undefined,
            signal:readController.current.signal
          });
          receivedEtag=bRes.etag??undefined;
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
            sharedDiaryCoordinator.primeFromEntries(b.entries, b.days, b.revision);
            const current=ref.current;
            const reuseFoods=current?.foodsLoaded===true&&current.state.foodRevision===b.foodRevision;
            const cachedFoods = reuseFoods || current?.foodsLoaded !== true ? undefined : await readSavedFoods(user);
            foodsLoaded=reuseFoods||isSavedFoodsCacheUsable(cachedFoods,b.foodRevision??b.revision);
            state = { ...b, foods: reuseFoods?current.state.foods:cachedFoods?.foods ?? current?.state.foods ?? [], trainingSummaries: current?.state.trainingSummaries ?? [], trainingSyncedAt: current?.state.trainingSyncedAt };
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
        state = await api<AppState>('/state' + (selected ? (selected.length === 4 ? '?year=' : '?date=') + selected : ''),undefined,'GET',{signal:readController.current.signal});
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
          if (state!.revision < current.state.revision || state===current.state) return current;
          const foods = state!.foods ?? (current.state.foods ?? []);
          const trainingSummaries = state!.trainingSummaries ?? (current.state.trainingSummaries ?? []);
          return { ...current, state: { ...state!, foods, trainingSummaries, workoutWarning: trainingWarning(current.state,state!,trainingLiveAccount.current) }, foodsLoaded };
        });
      }
      if(receivedEtag&&ref.current?.state.revision===state.revision)bootstrapEtag.current=receivedEtag;
      if(alive.current&&!ref.current?.queue.some(op=>op.retryAt)&&!ref.current?.photoDrafts?.length&&!ref.current?.bodyDrafts?.length)setError('');
    } catch (ex) {
      if (classifySyncFailure(ex) === 'session-expired') expireSession();
      throw ex;
    } finally {
      endActivity();
    }
    });
  }, [beginActivity, commit, expireSession, user, trainingLiveAccount]);
  const refreshHistory = useCallback(async (key: string) => {
    const todayDate = today(ref.current?.state.profile?.timeZone);
    await sharedDiaryCoordinator.requestDate(key, todayDate, { isNavigation: true });
  }, []);
  const loadSavedFoods=useSavedFoods(user,ref,alive,foodsEtag,commit);
  const pollRevisions = useCallback(() => singleFlight(revisionRequests.current,'revisions',()=>pollNutritionRevisions(user, ref, revisionsEtag, lastPeerRefresh, refresh, async()=>{await loadSavedFoods();}, loadTrainingSummaries,readController.current.signal)).catch(() => undefined),
    [loadSavedFoods, loadTrainingSummaries, refresh, user]);
  const refreshProgress=useProgressReads(ref,alive,readController,commit);
  const drain = useCallback(async () => {
    if (draining.current) { drainRequested.current = true; return; }
    if (!dispatchAllowed.current || sessionExpired.current || !ref.current) return;
    const nativeAcked = await reconcileNativeOutbox(user, () => alive.current, commit).catch(() => false);
    if (!navigator.onLine) return;
    const hadQueue = ref.current.queue.length > 0 || nativeAcked;
    let sent = nativeAcked;
    draining.current = true;
    const release=await acquireAccountDispatch(user).catch(ex=>{setError(ex instanceof Error?ex.message:'Local dispatch storage is unavailable.');return undefined;});
    if(!release){draining.current=false;return;}
    const reload=writes.current.catch(()=>undefined).then(async()=>{
      const durable=await reloadRetainedWork(user,ref.current,'queue');
      if(durable&&durable!==ref.current&&alive.current){ref.current=durable;setLocal(durable);}
    });
    writes.current=reload;
    try{await reload;}catch(ex){draining.current=false;await release().catch(ex=>{if(alive.current)setError(ex instanceof Error?ex.message:'Local dispatch storage is unavailable.');});setError((ex as Error).message);return;}
    const finishIntegrationBurst = beginIntegrationBurst();
    if (ref.current.queue.length) { beginSync(ref.current.queue[0]?.kind ?? 'entry'); setBusy(true); }
    try {
      sent = await runOutboxDrainLoop({
        user,
        isAlive: () => alive.current,
        isSessionExpired: () => sessionExpired.current,
        getQueue: () => ref.current?.queue,
        inFlightKeepalive: inFlightKeepalive.current,
        commit,
        setSendingRecordId: id => { if (alive.current) setSendingRecordId(id); },
        scheduleRetry: delayMs => {
          clearTimeout(heldDrainTimer.current);
          heldDrainTimer.current = setTimeout(() => { void drainRef.current(); }, delayMs);
        },
        onSessionExpired: expireSession,
        onRejectedNotice: message => showNotice(message)
      }) || nativeAcked;
      if (alive.current && hadQueue && sent) await refresh();
      if (alive.current && sent) setError('');
    } catch (ex) {
      if (alive.current) setError(ex instanceof Error ? ex.message : 'Sync is waiting for a connection.');
    } finally {
      draining.current = false;
      await release().catch(ex=>{if(alive.current)setError(ex instanceof Error?ex.message:'Local dispatch storage is unavailable.');});
      finishIntegrationBurst();
      if (alive.current) {
        setBusy(false);
        finishSync();
        if (drainRequested.current) { drainRequested.current = false; void drain(); }
      }
    }
  }, [beginSync, commit, expireSession, finishSync, refresh, user]);

  const drainRef = useRef(drain);
  drainRef.current = drain;
  useEffect(() => () => clearTimeout(heldDrainTimer.current), []);
  useEffect(() => {
    const imported = () => { if (alive.current) void refresh(); };
    window.addEventListener('nutrition:imported-weights', imported);
    return () => window.removeEventListener('nutrition:imported-weights', imported);
  }, [refresh]);

  const mutate = useCallback(async (op: Omit<Mutation, 'id' | 'holdUntil'>, options?: { holdMs?: number }) => {
    const fullOp: Mutation = { ...op, id: crypto.randomUUID(), ...(options?.holdMs ? { holdUntil: Date.now() + options.holdMs } : {}) };
    await commit(current => {validateFoodDestination(current.state,fullOp);return enqueueMutation(current,fullOp);});
    if (op.kind === 'entry') {
      const entryData = op.data as {date?:string}|null;
      if (entryData?.date) sharedDiaryCoordinator.projectDate(entryData.date, [fullOp]);
    }
    markSyncQueued(op.kind);
    void drain();
    return fullOp.id;
  }, [commit, drain, markSyncQueued]);

  const mutateMany=useCallback(async(operations:Omit<Mutation,'id'|'holdUntil'>[],options?:{holdMs?:number})=>{
    const full=operations.map(op=>({...op,id:crypto.randomUUID(),...(options?.holdMs?{holdUntil:Date.now()+options.holdMs}:{})}));
    await commit(current=>{full.forEach(op=>validateFoodDestination(current.state,op));return full.reduce((data,op)=>enqueueMutation(data,op),current);});
    if(full.length){markSyncQueued(full[0].kind);void drain();}
    return full.map(op=>op.id);
  },[commit,drain,markSyncQueued]);

  const undo = useCallback(async (ids: readonly string[]) => {
    let undone: string[] = [];
    await commit(current => {
      const result = undoHeldMutations(current.queue, ids, Date.now());
      undone = result.undone;
      return undone.length ? { ...current, queue: result.queue } : current;
    });
    if (undone.length) void drain();
    return undone.length === ids.length;
  }, [commit, drain]);
  const releaseHeld = useCallback(async (ids?: readonly string[]) => {
    clearTimeout(heldDrainTimer.current);
    await commit(current => {
      const queue = releaseHeldMutations(current.queue, ids);
      return queue === current.queue ? current : { ...current, queue };
    });
    if (ref.current?.queue.length) void drainRef.current();
  }, [commit]);
  const flushForBackground = useCallback(() => {
    if (!alive.current || !ref.current?.queue.length) return;
    clearTimeout(heldDrainTimer.current);
    flushBackgroundOutbox({
      user, queue: ref.current.queue,
      canSend: dispatchAllowed.current && !sessionExpired.current && navigator.onLine,
      draining: draining.current, inFlight: inFlightKeepalive.current,
      isAlive: () => alive.current, commit, dismissUndo: () => dismissToast(false),
      onErrorClear: () => { if (alive.current) setError(''); },
      onRejectedNotice: message => showNotice(message),
      onSessionExpired: expireSession,
      onSettled: () => { if (alive.current && !draining.current && ref.current?.queue.length) void drainRef.current(); }
    });
  }, [commit, expireSession, user]);
  const runPendingDrafts = useCallback(async () => {
    if (processingDrafts.current) { draftsRequested.current = true; return; }
    if (!dispatchAllowed.current || sessionExpired.current || !navigator.onLine || !ref.current) return;
    processingDrafts.current = true;
    const release=await acquireAccountDispatch(user).catch(ex=>{setError(ex instanceof Error?ex.message:'Local dispatch storage is unavailable.');return undefined;});
    if(!release){processingDrafts.current=false;return;}
    try {
      const reload=writes.current.catch(()=>undefined).then(async()=>{
        const durable=await reloadRetainedWork(user,ref.current,'drafts');
        if(durable&&durable!==ref.current&&alive.current){ref.current=durable;setLocal(durable);}
      });writes.current=reload;await reload;
      const {uploadPendingDrafts}=await import('./lib/nutritionDraftUpload');
      await uploadPendingDrafts({
        accountId:user,
        isAlive: () => alive.current,
        getDrafts: () => ref.current,
        commit,
        beginSync,
        finishSync,
        setError,
        expireSession
      });
    } catch(ex){
      if(alive.current)setError(ex instanceof Error?ex.message:'Retained work could not be read or saved.');
    } finally {
      processingDrafts.current = false;
      await release().catch(ex=>{if(alive.current)setError(ex instanceof Error?ex.message:'Local dispatch storage is unavailable.');});
      if(alive.current&&draftsRequested.current){draftsRequested.current=false;void runPendingDrafts();}
    }
  }, [beginSync, commit, finishSync,expireSession,user]);
  useEffect(()=>{if(authReady){void drain();void runPendingDrafts();}},[authReady,drain,runPendingDrafts]);
  useEffect(()=>subscribeAccountWork(user,()=>{
    const task=writes.current.catch(()=>undefined).then(async()=>{
      const saved=await readLocal(user);
      if(saved&&alive.current){ref.current=saved;setLocal(saved);}
    });
    writes.current=task;
    void task.catch(()=>undefined);
  }),[user]);

  useEffect(() => {
    sharedDiaryCoordinator.setUser(user);
    // Validators are account-scoped. Drop them before loading another account so a
    // same-number revision can never reuse a previous account's 304 response.
    bootstrapEtag.current = undefined;
    foodsEtag.current = undefined;
    revisionsEtag.current = undefined;
    lastPeerRefresh.current = 0;
    alive.current = true;
    readController.current = new AbortController();
    void (async () => {
      try {
        const finishHydration=measurePerformance('workspace.hydration');
        const cached = await hydrateAccount(user).finally(finishHydration);
        clearAccountHydration(user);
        const normalized = cached ? stripLegacyScanDrafts(cached) : undefined;
        if (normalized && alive.current) {
          if (normalized !== cached) await saveLocal(user, normalized);
          ref.current = normalized;
          setLocal(normalized);
          sharedDiaryCoordinator.primeFromEntries(normalized.state.entries, normalized.state.days, normalized.state.revision);
        }
        await refresh();
        await reconcileNativeOutbox(user, () => alive.current, commit).catch(() => false);
        if (ref.current?.queue.length) await drain();
        await runPendingDrafts();
      } catch (ex) {
        if (alive.current) setError(ex instanceof Error ? ex.message : 'Could not load diary.');
      }
    })();

    const wake = (forceVisible = false) => {
      if (forceVisible || document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastWake.current < 2000) return;
        lastWake.current = now;
        setCalendarDate(today(ref.current?.state.profile?.timeZone));
        void (async () => {
          const refreshedBefore = lastPeerRefresh.current;
          await drain();
          // drain refreshes after successful queued writes. A clean wake still
          // needs one conditional foreground refresh.
          if (lastPeerRefresh.current === refreshedBefore && alive.current) await pollRevisions();
        })();
        void runPendingDrafts();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushForBackground();
      else wake();
    };
    const onOnline = () => wake();

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flushForBackground);
    let stopNativeLifecycle: (() => void) | undefined;
    void subscribeNativeBackgroundLifecycle(() => wake(true), flushForBackground).then(stop => {
      if (alive.current) stopNativeLifecycle = stop;
      else stop();
    });

    let heartbeat = Date.now();
    const retained = () => Boolean(ref.current && (ref.current.queue.length || ref.current.photoDrafts?.length || ref.current.bodyDrafts?.length));
    const interval = window.setInterval(() => {
      // Local day resolution must keep advancing while network polling is suspended.
      if(document.visibilityState==='visible')setCalendarDate(today(ref.current?.state.profile?.timeZone));
      if (document.visibilityState==='visible'&&navigator.onLine&&(retained() || Date.now() - heartbeat >= 30000)) {
        heartbeat = Date.now();
        wake();
      }
    }, 10000);

    return () => {
      alive.current = false;
      readController.current.abort();
      sharedDiaryCoordinator.reset();
      clearSyncTimer();
      if (activityTimer.current !== undefined) clearTimeout(activityTimer.current);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flushForBackground);
      stopNativeLifecycle?.();
      clearInterval(interval);
    };
  }, [user, refresh, refreshProgress, drain, flushForBackground, commit, runPendingDrafts, pollRevisions]);

  const toggleFoodFavourite=useFoodFavourite(ref,loadSavedFoods,mutate);

  const actions=useNutritionStoreActions(commit,markSyncQueued,drain,runPendingDrafts);
  const state = useMemo(() => local ? project(local.state, local.queue) : undefined, [local?.state,local?.queue]);

  return {
    state, local, error, busy, sendingRecordId, sync, isActivityActive, beginActivity, mutate, mutateMany, undo, releaseHeld, refresh, refreshHistory, refreshProgress, loadSavedFoods, toggleFoodFavourite, loadTrainingSummaries, trainingLoading, trainingError, trainingResolved, drain, calendarDate,
    ...actions,
  };
}

export type NutritionStore = ReturnType<typeof useNutritionStore>;

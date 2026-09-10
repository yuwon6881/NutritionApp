import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {AppState,LocalData,Mutation,ScanDraft,AiDraft,PhysiqueAngle,PhysiqueDraft} from './types';
import {api,ApiError} from './lib/api';
import {readLocal,saveLocal} from './lib/local';
import {today} from './lib/format';
import {project,rebaseAfterOwnWrite,wireMutation} from './lib/projection';
import {acknowledgeHistory} from './lib/history';

export type SyncKind=Mutation['kind']|'scan'|'photo';
export type SyncPhase='idle'|'queued'|'syncing'|'synced';
export type SyncState={phase:SyncPhase;kind?:SyncKind};

const MIN_SYNC_ACTIVE_MS=420;
const SYNC_SUCCESS_VISIBLE_MS=900;

function queueEntries(current:LocalData,entries:unknown[]):Mutation[]{
  return [
    ...current.queue,
    ...entries.map(data=>({
      id:crypto.randomUUID(),
      kind:'entry' as const,
      recordId:crypto.randomUUID(),
      expectedRevision:0,
      data,
      delete:false
    }))
  ];
}

function normalizePhotoDraft(value:PhysiqueDraft):PhysiqueDraft{
  // Retain drafts created by the previous one-photo contract while users move
  // to the set-based uploader. They are uploaded as a front slot without
  // restoring removed photo metadata.
  const legacy=value as PhysiqueDraft&{angle?:string;imageBase64?:string};
  if(Array.isArray(value.photos))return value;
  const angle=(legacy.angle==='side'||legacy.angle==='back')?legacy.angle as PhysiqueAngle:'front';
  return {id:value.id,date:value.date,photos:legacy.imageBase64?[{id:value.id,angle,imageBase64:legacy.imageBase64}]:[]};
}

export function useNourish(user:string){
  const [calendarDate,setCalendarDate]=useState(today());
  const [local,setLocal]=useState<LocalData>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [sync,setSync]=useState<SyncState>({phase:'idle'});
  const ref=useRef<LocalData|undefined>(undefined);const writes=useRef(Promise.resolve());const draining=useRef(false);const scanning=useRef(false);const alive=useRef(true);
  const drainRequested=useRef(false);
  const windowDate=useRef<string|undefined>(undefined);const refreshSequence=useRef(0);
  const historySequences=useRef(new Map<string,number>());
  const syncTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const activeSync=useRef(0);const syncStartedAt=useRef<number|undefined>(undefined);
  const clearSyncTimer=useCallback(()=>{if(syncTimer.current!==undefined){clearTimeout(syncTimer.current);syncTimer.current=undefined;}},[]);
  const markSyncQueued=useCallback((kind:SyncKind)=>{
    if(activeSync.current)return;
    clearSyncTimer();setSync({phase:'queued',kind});
  },[clearSyncTimer]);
  const beginSync=useCallback((kind:SyncKind)=>{
    if(activeSync.current===0){
      clearSyncTimer();syncStartedAt.current=Date.now();setSync({phase:'syncing',kind});
    }
    activeSync.current+=1;
  },[clearSyncTimer]);
  const finishSync=useCallback(()=>{
    if(activeSync.current===0)return;
    activeSync.current-=1;if(activeSync.current)return;
    const delay=Math.max(0,MIN_SYNC_ACTIVE_MS-(Date.now()-(syncStartedAt.current??Date.now())));
    const showSuccess=()=>{
      syncTimer.current=undefined;
      if(!alive.current)return;
      setSync(current=>({phase:'synced',kind:current.kind}));
      syncTimer.current=setTimeout(()=>{if(alive.current)setSync({phase:'idle'});},SYNC_SUCCESS_VISIBLE_MS);
    };
    if(delay)syncTimer.current=setTimeout(showSuccess,delay);else showSuccess();
  },[]);
  const commit=useCallback(async(change:(data:LocalData)=>LocalData)=>{
    const task=writes.current.catch(()=>{}).then(async()=>{if(!alive.current||!ref.current)return;const next=change(ref.current);if(next===ref.current)return;await saveLocal(user,next);if(!alive.current)return;ref.current=next;setLocal(next);});
    writes.current=task;return task;
  },[user]);
  const refresh=useCallback(async(date?:string)=>{
    if(date!==undefined)windowDate.current=date==='recent'?undefined:date;
    const selected=windowDate.current;const sequence=++refreshSequence.current;
    const state=await api<AppState>('/state'+(selected?(selected.length===4?'?year=':'?date=')+selected:''));
    if(!alive.current||sequence!==refreshSequence.current)return;
    if(state.id!==user)throw new Error('The signed-in account changed. Sign in again.');
    if(!ref.current){const data={state,queue:[],scans:[]};await saveLocal(user,data);if(alive.current){ref.current=data;setLocal(data);}}
    else await commit(current=>state.revision<current.state.revision||JSON.stringify(state)===JSON.stringify(current.state)?current:{...current,state});
  },[commit,user]);
  const refreshHistory=useCallback(async(key:string)=>{
    const sequence=(historySequences.current.get(key)??0)+1;historySequences.current.set(key,sequence);
    const state=await api<AppState>('/state'+(key==='recent'?'':(key.length===4?'?year=':'?date=')+encodeURIComponent(key)));
    if(!alive.current||historySequences.current.get(key)!==sequence)return;
    if(state.id!==user)throw new Error('The signed-in account changed. Sign in again.');
    await commit(current=>{
      if(historySequences.current.get(key)!==sequence||state.revision<current.state.revision)return current;
      const previous=current.history?.[key];
      if(previous&&state.revision<previous.revision)return current;
      // Bound downloaded history only; retained mutations and image drafts are never evicted.
      const history={...current.history};delete history[key];history[key]=state;
      while(Object.keys(history).length>16)delete history[Object.keys(history)[0]];
      return {...current,history};
    });
  },[commit,user]);
  const drain=useCallback(async()=>{
    if(draining.current||!navigator.onLine||!ref.current)return;
    draining.current=true;if(ref.current.queue.length){beginSync(ref.current.queue[0]?.kind??'entry');setBusy(true);}
    try{
      while(alive.current&&ref.current?.queue.length){
        const op=ref.current.queue[0];if(op.error)break;
        try{
          const {revision}=await api<{revision:number}>('/sync',wireMutation(op));
          await commit(current=>{
            // Persist the acknowledged projection with its receipt before downloading fresh state.
            const state=project(current.state,[op]);state.revision=revision;
            if(op.kind==='profile')state.profileRevision=revision;
            else if(op.kind==='settings'){if(state.settings)state.settings.revision=revision;}
            else {const key={entry:'entries',food:'foods',weight:'weights',day:'days'}[op.kind] as 'entries'|'foods'|'weights'|'days';const item=state[key].find(r=>r.id===op.recordId);if(item)item.revision=revision;}
            const queue=rebaseAfterOwnWrite(current.queue,op,revision);
            if(op.kind==='entry'){
              const date=(op.data as {date?:string}).date;
              for(const day of state.days)if(day.date===date){day.revision=revision;for(const q of queue)if(q.kind==='day'&&q.recordId===day.id)q.expectedRevision=revision;}
            }
            const history=Object.fromEntries(Object.entries(current.history??{}).map(([key,saved])=>[key,acknowledgeHistory(saved,op,revision)]));
            return {...current,state,queue,history};
          });
        }catch(ex){
          if(ex instanceof ApiError&&[400,409,422].includes(ex.status))await commit(current=>({...current,queue:current.queue.map(q=>q.id===op.id?{...q,error:ex.message}:q)}));
          throw ex;
        }
      }
      if(alive.current)await refresh();setError('');
    }catch(ex){if(alive.current)setError(ex instanceof Error?ex.message:'Sync is waiting for a connection.');}
    finally{draining.current=false;if(alive.current){setBusy(false);finishSync();if(drainRequested.current){drainRequested.current=false;void drain();}}}
  },[beginSync,commit,finishSync,refresh]);
  const mutate=useCallback(async(op:Omit<Mutation,'id'>)=>{
    await commit(current=>{
      // Settings are a single revisioned record. Coalesce rapid selector
      // changes so choosing pounds + kJ + feet/inches offline produces one
      // durable mutation instead of a chain of stale-revision conflicts.
      if(op.kind==='settings'){
        const queued=current.queue.find(item=>item.kind==='settings'&&!item.error);
        if(queued)return {...current,queue:current.queue.map(item=>item.id===queued.id?{...item,data:{...(item.data as object),...(op.data as object)} }:item)};
      }
      return {...current,queue:[...current.queue,{...op,id:crypto.randomUUID()}]};
    });
    markSyncQueued(op.kind);
    if(draining.current)drainRequested.current=true;else void drain();
  },[commit,drain,markSyncQueued]);
  const runScans=useCallback(async()=>{
    if(scanning.current||!navigator.onLine||!ref.current)return;scanning.current=true;
    const hasScanWork=ref.current.scans.some(scan=>!scan.result&&!scan.error);
    const hasPhotoWork=(ref.current.photoDrafts??[]).some(draft=>!draft.error);
    if(!hasScanWork&&!hasPhotoWork){scanning.current=false;return;}
    beginSync(hasScanWork?'scan':'photo');
    try{
      for(const draft of [...ref.current.scans]){
        if(!alive.current||draft.result||draft.error)continue;
        try{
          type Job={id:string;status:string;resultJson:string|null;error:string|null};
          let job=draft.jobId?await api<Job>('/scans/'+draft.jobId):await api<Job>('/scans',{id:draft.id,mode:draft.mode,description:draft.description,imageBase64:draft.imageBase64});
          await commit(current=>({...current,scans:current.scans.map(s=>s.id===draft.id?{...s,jobId:job.id}:s)}));
          if(job.status==='queued'||job.status==='processing')job=await api<Job>('/scans/'+job.id+'/process',{});
          if(job.status==='complete')await commit(current=>({...current,scans:current.scans.map(s=>s.id===draft.id?{...s,result:JSON.parse(job.resultJson!) as AiDraft,imageBase64:null}:s)}));
          else if(job.status==='failed')throw new ApiError(job.error??'Scan failed. Retry the retained draft.',422);
        }catch(ex){
          if(ex instanceof ApiError&&[400,404,409,422,429,507].includes(ex.status))await commit(current=>({...current,scans:current.scans.map(s=>s.id===draft.id?{...s,error:ex.message}:s)}));
          else setError(ex instanceof Error?ex.message:'Scan will retry when connected.');
        }
      }
      for(const draft of [...(ref.current.photoDrafts??[])]){
        if(!alive.current||draft.error)continue;
        try{
          const normalized=normalizePhotoDraft(draft);
          const {error:_,...input}=normalized;
          await api('/photos',input);
          await commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).filter(p=>p.id!==draft.id)}));
        }
        catch(ex){if(ex instanceof ApiError)await commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).map(p=>p.id===draft.id?{...p,error:ex.message}:p)}));else setError('Photo is retained and will retry when connected.');}
      }
    }finally{scanning.current=false;finishSync();}
  },[beginSync,commit,finishSync]);
  useEffect(()=>{
    alive.current=true;
    void (async()=>{try{const cached=await readLocal(user);if(cached&&alive.current){ref.current=cached;setLocal(cached);}await refresh();if(ref.current?.queue.length)await drain();await runScans();}catch(ex){if(alive.current)setError(ex instanceof Error?ex.message:'Could not load diary.');}})();
    const wake=()=>{if(document.visibilityState==='visible'){setCalendarDate(today(ref.current?.state.profile?.timeZone));void drain();void runScans();}};
    window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
    // A page reloaded while offline reports neither the online event nor a false navigator.onLine,
    // so retained work retries on a short cycle. An empty queue keeps the slow heartbeat.
    let heartbeat=Date.now();
    const retained=()=>Boolean(ref.current&&(ref.current.queue.length||ref.current.scans.length||ref.current.photoDrafts?.length));
    const interval=window.setInterval(()=>{if(retained()||Date.now()-heartbeat>=30000){heartbeat=Date.now();wake();}},10000);
    return()=>{alive.current=false;clearSyncTimer();window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);clearInterval(interval);};
  },[user,refresh,drain,runScans]);
  const state=useMemo(()=>local?project(local.state,local.queue):undefined,[local]);
  return {state,local,error,busy,sync,mutate,refresh,refreshHistory,drain,calendarDate,
    logEntries:async(entries:unknown[])=>{
      await commit(current=>({...current,queue:queueEntries(current,entries)}));
      markSyncQueued('entry');
      void drain();
    },
    saveReviewedScan:async(scanId:string,entries:unknown[])=>{
      await commit(current=>({...current,queue:queueEntries(current,entries),scans:current.scans.filter(s=>s.id!==scanId)}));
      markSyncQueued('entry');
      void drain();
    },
    discardConflict:async(id:string)=>{await commit(c=>({...c,queue:c.queue.filter(q=>q.id!==id)}));await drain();},
    addScan:async(draft:ScanDraft)=>{await commit(c=>({...c,scans:[...c.scans,draft]}));markSyncQueued('scan');void runScans();},
    removeScan:async(id:string)=>commit(c=>({...c,scans:c.scans.filter(s=>s.id!==id)})),
    retryScan:async(id:string)=>{await commit(c=>({...c,scans:c.scans.map(s=>s.id===id?{...s,id:crypto.randomUUID(),jobId:undefined,error:undefined}:s)}));void runScans();},
    addPhoto:async(draft:PhysiqueDraft)=>{await commit(c=>({...c,photoDrafts:[...(c.photoDrafts??[]).filter(photo=>photo.id!==draft.id),draft]}));markSyncQueued('photo');void runScans();},
    retryPhoto:async(id:string)=>{await commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).map(p=>p.id===id?{...p,id:/expired|deleted/i.test(p.error??'')?crypto.randomUUID():p.id,error:undefined}:p)}));void runScans();},
    removePhotoDraft:async(id:string)=>commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).filter(p=>p.id!==id)})),
  };
}
export type Nourish=ReturnType<typeof useNourish>;


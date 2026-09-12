import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {AppState,LocalData,Mutation,ScanDraft,AiDraft,PhysiqueAngle,PhysiqueDraft,ProgressSummary,BodyDraft} from './types';
import {api,ApiError} from './lib/api';
import {readLocal,saveLocal} from './lib/local';
import {today} from './lib/format';
import {project,rebaseAfterOwnWrite,wireMutation} from './lib/projection';
import {acknowledgeHistory} from './lib/history';

export type SyncKind=Mutation['kind']|'scan'|'photo'|'body';
export type SyncPhase='idle'|'queued'|'syncing'|'synced';
export type SyncState={phase:SyncPhase;kind?:SyncKind};

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
  const progressSequences=useRef(new Map<string,number>());
  const progressRequests=useRef(new Map<string,Promise<void>>());
  const syncTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const activeSync=useRef(0);const syncStartedAt=useRef<number|undefined>(undefined);
  const activeOperations=useRef(new Set<string>());
  const [isActivityActive,setIsActivityActive]=useState(false);
  const isActivityActiveRef=useRef(false);
  const activityTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);

  const checkActivity=useCallback(()=>{
    const hasWork=activeOperations.current.size>0||activeSync.current>0;
    if(hasWork){
      if(activityTimer.current===undefined&&!isActivityActiveRef.current){
        activityTimer.current=setTimeout(()=>{
          activityTimer.current=undefined;
          if(!alive.current)return;
          if(activeOperations.current.size>0||activeSync.current>0){
            isActivityActiveRef.current=true;
            setIsActivityActive(true);
          }
        },300);
      }
    }else{
      if(activityTimer.current!==undefined){
        clearTimeout(activityTimer.current);
        activityTimer.current=undefined;
      }
      if(isActivityActiveRef.current){
        isActivityActiveRef.current=false;
        setIsActivityActive(false);
      }
    }
  },[]);

  const beginActivity=useCallback((id:string)=>{
    activeOperations.current.add(id);
    checkActivity();
    return ()=>{
      activeOperations.current.delete(id);
      checkActivity();
    };
  },[checkActivity]);

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
    checkActivity();
  },[checkActivity,clearSyncTimer]);
  const finishSync=useCallback(()=>{
    if(activeSync.current===0)return;
    activeSync.current-=1;
    checkActivity();
    if(activeSync.current)return;
    clearSyncTimer();
    if(alive.current){
      setSync({phase:'idle'});
    }
  },[checkActivity,clearSyncTimer]);
  const commit=useCallback(async(change:(data:LocalData)=>LocalData)=>{
    const task=writes.current.catch(()=>{}).then(async()=>{if(!alive.current||!ref.current)return;const next=change(ref.current);if(next===ref.current)return;await saveLocal(user,next);if(!alive.current)return;ref.current=next;setLocal(next);});
    writes.current=task;return task;
  },[user]);
  const refresh=useCallback(async(date?:string)=>{
    const endActivity=beginActivity('refresh');
    try{
      if(date!==undefined)windowDate.current=date==='recent'?undefined:date;
      const selected=windowDate.current;const sequence=++refreshSequence.current;
      const state=await api<AppState>('/state'+(selected?(selected.length===4?'?year=':'?date=')+selected:''));
      if(!alive.current||sequence!==refreshSequence.current)return;
      if(state.id!==user)throw new Error('The signed-in account changed. Sign in again.');
      if(!ref.current){const data={state,queue:[],scans:[]};await saveLocal(user,data);if(alive.current){ref.current=data;setLocal(data);}}
      else await commit(current=>state.revision<current.state.revision||JSON.stringify(state)===JSON.stringify(current.state)?current:{...current,state});
    }finally{
      endActivity();
    }
  },[beginActivity,commit,user]);
  const refreshHistory=useCallback(async(key:string)=>{
    const endActivity=beginActivity('history:'+key);
    try{
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
    }finally{
      endActivity();
    }
  },[beginActivity,commit,user]);
  const refreshProgress=useCallback((period:string)=>{
    const running=progressRequests.current.get(period);
    if(running)return running;
    const sequence=(progressSequences.current.get(period)??0)+1;
    progressSequences.current.set(period,sequence);
    const request=(async()=>{
      const summary=await api<ProgressSummary>('/progress/summary?period='+encodeURIComponent(period));
      if(!alive.current||progressSequences.current.get(period)!==sequence)return;
      await commit(current=>{
        const previous=current.progress?.[period];
        if(previous&&summary.revision<previous.revision)return current;
        return {...current,progress:{...(current.progress??{}),[period]:summary}};
      });
    })().finally(()=>{progressRequests.current.delete(period);});
    progressRequests.current.set(period,request);
    return request;
  },[commit]);
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
    const hasScanWork=ref.current.scans.some(scan=>scan.submitted!==false&&!scan.result&&!scan.error);
    const hasPhotoWork=(ref.current.photoDrafts??[]).some(draft=>!draft.error);
    const hasBodyWork=(ref.current.bodyDrafts??[]).some(draft=>!draft.error);
    if(!hasScanWork&&!hasPhotoWork&&!hasBodyWork){scanning.current=false;return;}
    beginSync(hasScanWork?'scan':hasBodyWork?'body':'photo');
    try{
      for(const draft of [...ref.current.scans]){
        if(!alive.current||draft.submitted===false||draft.result||draft.error)continue;
        try{
          type Job={id:string;status:string;resultJson:string|null;error:string|null};
          let job=draft.jobId?await api<Job>('/scans/'+draft.jobId):await api<Job>('/scans',{id:draft.id,mode:draft.mode,description:draft.description,imageBase64:draft.imageBase64});
          await commit(current=>({...current,scans:current.scans.map(s=>s.id===draft.id?{...s,jobId:job.id}:s)}));
          if(job.status==='queued'||job.status==='processing')job=await api<Job>('/scans/'+job.id+'/process',{});
          if(job.status==='complete')await commit(current=>({...current,scans:current.scans.map(s=>s.id===draft.id?{...s,result:JSON.parse(job.resultJson!) as AiDraft,imageBase64:null}:s)}));
          else if(job.status==='failed')throw new ApiError(job.error??'Scan failed. Retry the retained draft.',422);
        }catch(ex){
          // HTTP failures are server-side scan outcomes, not offline state.
          // Keep the draft for an explicit retry and show the provider/API
          // message instead of claiming it is merely waiting for a connection.
          if(ex instanceof ApiError&&ex.status!==401&&ex.status!==403)await commit(current=>({...current,scans:current.scans.map(s=>s.id===draft.id?{...s,error:ex.message}:s)}));
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
      for(const draft of [...(ref.current.bodyDrafts??[])]){
        if(!alive.current||draft.error)continue;
        try{
          type BodyResponse={id:string;revision:number};
          const action=draft.action??'save';
          const body=draft.serverRevision!=null?{id:draft.id,revision:draft.serverRevision}:await api<BodyResponse>('/body-records/'+draft.id,{
            id:draft.mutationId,expectedRevision:draft.expectedRevision,action,
            ...(action==='save'?{data:{date:draft.date,measurements:draft.measurements,photos:draft.photos.map(photo=>({id:photo.id,angle:photo.angle})),weightContext:draft.weightContext,omitScale:draft.omitScale??false,omitTrend:draft.omitTrend??false}}:{})
          });
          await commit(c=>({...c,bodyDrafts:(c.bodyDrafts??[]).map(item=>item.id===draft.id?{...item,serverRevision:body.revision,expectedRevision:body.revision,error:undefined}:item)}));
          let revision=body.revision;
          if(draft.photos.length){
            const photoMutationId=draft.photoMutationId??crypto.randomUUID();
            if(!draft.photoMutationId)await commit(c=>({...c,bodyDrafts:(c.bodyDrafts??[]).map(item=>item.id===draft.id?{...item,photoMutationId}:item)}));
            const uploaded=await api<{revision:number}>('/body-records/'+draft.id+'/photos',{
              id:draft.id,date:draft.date,photos:draft.photos,mutationId:photoMutationId,expectedRevision:revision
            });
            revision=uploaded.revision;
          }
          for(const photoId of draft.deletePhotoIds??[]){
            const mutationId=draft.deleteMutationIds?.[photoId]??crypto.randomUUID();
            if(!draft.deleteMutationIds?.[photoId])await commit(c=>({...c,bodyDrafts:(c.bodyDrafts??[]).map(item=>item.id===draft.id?{...item,deleteMutationIds:{...(item.deleteMutationIds??{}),[photoId]:mutationId}}:item)}));
            const deleted=await api<{revision:number}>('/body-records/'+draft.id,{
              id:mutationId,expectedRevision:revision,action:'photo-delete',photoId
            });
            revision=deleted.revision;
          }
          await commit(c=>({...c,bodyDrafts:(c.bodyDrafts??[]).filter(item=>item.id!==draft.id)}));
        }catch(ex){
          if(ex instanceof ApiError)await commit(c=>({...c,bodyDrafts:(c.bodyDrafts??[]).map(item=>item.id===draft.id?{...item,error:ex.message}:item)}));
          else setError('Body record is retained and will retry when connected.');
        }
      }
    }finally{scanning.current=false;finishSync();}
  },[beginSync,commit,finishSync]);
  useEffect(()=>{
    alive.current=true;
    void (async()=>{try{const cached=await readLocal(user);if(cached&&alive.current){ref.current=cached;setLocal(cached);}await refresh();if(ref.current?.queue.length)await drain();await runScans();}catch(ex){if(alive.current)setError(ex instanceof Error?ex.message:'Could not load diary.');}})();
    const wake=()=>{if(document.visibilityState==='visible'){
      setCalendarDate(today(ref.current?.state.profile?.timeZone));
      void drain();void runScans();
      for(const period of Object.keys(ref.current?.progress??{}))void refreshProgress(period);
    }};
    window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
    // A page reloaded while offline reports neither the online event nor a false navigator.onLine,
    // so retained work retries on a short cycle. An empty queue keeps the slow heartbeat.
    let heartbeat=Date.now();
    const retained=()=>Boolean(ref.current&&(ref.current.queue.length||ref.current.scans.length||ref.current.photoDrafts?.length||ref.current.bodyDrafts?.length));
    const interval=window.setInterval(()=>{if(retained()||Date.now()-heartbeat>=30000){heartbeat=Date.now();wake();}},10000);
    return()=>{
      alive.current=false;
      clearSyncTimer();
      if(activityTimer.current!==undefined)clearTimeout(activityTimer.current);
      window.removeEventListener('online',wake);
      document.removeEventListener('visibilitychange',wake);
      clearInterval(interval);
    };
  },[user,refresh,refreshProgress,drain,runScans]);
  const state=useMemo(()=>local?project(local.state,local.queue):undefined,[local]);
  return {state,local,error,busy,sync,isActivityActive,beginActivity,mutate,refresh,refreshHistory,refreshProgress,drain,calendarDate,
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
    saveScanDraft:async(draft:ScanDraft)=>commit(c=>{
      const next={...draft,submitted:false};
      const existing=c.scans.find(scan=>scan.id===draft.id);
      if(existing&&JSON.stringify(existing)===JSON.stringify(next))return c;
      return {...c,scans:existing?c.scans.map(scan=>scan.id===draft.id?next:scan):[...c.scans,next]};
    }),
    submitScan:async(draft:ScanDraft)=>{await commit(c=>{
      const next={...draft,submitted:true};
      const existing=c.scans.find(scan=>scan.id===draft.id);
      return {...c,scans:existing?c.scans.map(scan=>scan.id===draft.id?next:scan):[...c.scans,next]};
    });markSyncQueued('scan');await runScans();},
    addScan:async(draft:ScanDraft)=>{await commit(c=>({...c,scans:[...c.scans,{...draft,submitted:true}]}));markSyncQueued('scan');await runScans();},
    removeScan:async(id:string)=>commit(c=>({...c,scans:c.scans.filter(s=>s.id!==id)})),
    retryScan:async(id:string)=>{const nextId=crypto.randomUUID();await commit(c=>({...c,scans:c.scans.map(s=>s.id===id?{...s,id:nextId,jobId:undefined,error:undefined,submitted:true}:s)}));await runScans();return nextId;},
    addPhoto:async(draft:PhysiqueDraft)=>{await commit(c=>({...c,photoDrafts:[...(c.photoDrafts??[]).filter(photo=>photo.id!==draft.id),draft]}));markSyncQueued('photo');void runScans();},
    retryPhoto:async(id:string)=>{await commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).map(p=>p.id===id?{...p,id:/expired|deleted/i.test(p.error??'')?crypto.randomUUID():p.id,error:undefined}:p)}));void runScans();},
    removePhotoDraft:async(id:string)=>commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).filter(p=>p.id!==id)})),
    saveBodyDraft:async(draft:BodyDraft)=>{await commit(c=>{const existing=c.bodyDrafts?.find(item=>item.id===draft.id);return {...c,bodyDrafts:existing?(c.bodyDrafts??[]).map(item=>item.id===draft.id?draft:item):[...(c.bodyDrafts??[]),draft]};});markSyncQueued('body');await runScans();},
    retryBody:async(id:string)=>{await commit(c=>({...c,bodyDrafts:(c.bodyDrafts??[]).map(item=>item.id===id?{...item,error:undefined}:item)}));void runScans();},
    removeBodyDraft:async(id:string)=>commit(c=>({...c,bodyDrafts:(c.bodyDrafts??[]).filter(item=>item.id!==id)})),
  };
}
export type Nourish=ReturnType<typeof useNourish>;


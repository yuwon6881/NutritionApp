import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {AppState,LocalData,Mutation,ScanDraft,AiDraft,PhysiqueDraft} from './types';
import {api,ApiError} from './lib/api';
import {readLocal,saveLocal} from './lib/local';
import {project,rebaseAfterOwnWrite,wireMutation} from './lib/projection';

export function useNourish(user:string){
  const [local,setLocal]=useState<LocalData>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const ref=useRef<LocalData|undefined>(undefined);const writes=useRef(Promise.resolve());const draining=useRef(false);const scanning=useRef(false);const alive=useRef(true);
  const windowDate=useRef<string|undefined>(undefined);
  const commit=useCallback(async(change:(data:LocalData)=>LocalData)=>{
    const task=writes.current.catch(()=>{}).then(async()=>{if(!alive.current||!ref.current)return;const next=change(ref.current);await saveLocal(user,next);if(!alive.current)return;ref.current=next;setLocal(next);});
    writes.current=task;return task;
  },[user]);
  const refresh=useCallback(async(date?:string)=>{
    if(date!==undefined)windowDate.current=date==='recent'?undefined:date;
    const selected=windowDate.current;
    const state=await api<AppState>('/state'+(selected?(selected.length===4?'?year=':'?date=')+selected:''));
    if(state.id!==user)throw new Error('The signed-in account changed. Sign in again.');
    if(!ref.current){const data={state,queue:[],scans:[]};await saveLocal(user,data);if(alive.current){ref.current=data;setLocal(data);}}
    else await commit(current=>({...current,state}));
  },[commit,user]);
  const drain=useCallback(async()=>{
    if(draining.current||!navigator.onLine||!ref.current)return;
    draining.current=true;setBusy(true);
    try{
      while(alive.current&&ref.current?.queue.length){
        const op=ref.current.queue[0];if(op.error)break;
        try{
          const {revision}=await api<{revision:number}>('/sync',wireMutation(op));
          await commit(current=>{
            // Persist the acknowledged projection with its receipt before downloading fresh state.
            const state=project(current.state,[op]);state.revision=revision;
            if(op.kind==='profile')state.profileRevision=revision;
            else {const key={entry:'entries',food:'foods',weight:'weights',day:'days'}[op.kind] as 'entries'|'foods'|'weights'|'days';const item=state[key].find(r=>r.id===op.recordId);if(item)item.revision=revision;}
            const queue=rebaseAfterOwnWrite(current.queue,op,revision);
            if(op.kind==='entry'){
              const date=(op.data as {date?:string}).date;
              for(const day of state.days)if(day.date===date){day.revision=revision;for(const q of queue)if(q.kind==='day'&&q.recordId===day.id)q.expectedRevision=revision;}
            }
            return {...current,state,queue};
          });
        }catch(ex){
          if(ex instanceof ApiError&&[400,409,422].includes(ex.status))await commit(current=>({...current,queue:current.queue.map(q=>q.id===op.id?{...q,error:ex.message}:q)}));
          throw ex;
        }
      }
      if(alive.current)await refresh();setError('');
    }catch(ex){if(alive.current)setError(ex instanceof Error?ex.message:'Sync is waiting for a connection.');}
    finally{draining.current=false;if(alive.current)setBusy(false);}
  },[commit,refresh]);
  const mutate=useCallback(async(op:Omit<Mutation,'id'>)=>{
    await commit(current=>({...current,queue:[...current.queue,{...op,id:crypto.randomUUID()}]}));
    void drain();
  },[commit,drain]);
  const runScans=useCallback(async()=>{
    if(scanning.current||!navigator.onLine||!ref.current)return;scanning.current=true;
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
        try{const {error:_,...input}=draft;await api('/photos',input);await commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).filter(p=>p.id!==draft.id)}));}
        catch(ex){if(ex instanceof ApiError)await commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).map(p=>p.id===draft.id?{...p,error:ex.message}:p)}));else setError('Photo is retained and will retry when connected.');}
      }
    }finally{scanning.current=false;}
  },[commit]);
  useEffect(()=>{
    alive.current=true;
    void (async()=>{try{const cached=await readLocal(user);if(cached&&alive.current){ref.current=cached;setLocal(cached);}await refresh();await drain();await runScans();}catch(ex){if(alive.current)setError(ex instanceof Error?ex.message:'Could not load diary.');}})();
    const wake=()=>{if(document.visibilityState==='visible'){void drain();void runScans();}};
    window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
    const interval=window.setInterval(wake,30000);
    return()=>{alive.current=false;window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);clearInterval(interval);};
  },[user,refresh,drain,runScans]);
  const state=useMemo(()=>local?project(local.state,local.queue):undefined,[local]);
  return {state,local,error,busy,mutate,refresh,drain,
    discardConflict:async(id:string)=>{await commit(c=>({...c,queue:c.queue.filter(q=>q.id!==id)}));await drain();},
    addScan:async(draft:ScanDraft)=>{await commit(c=>({...c,scans:[...c.scans,draft]}));void runScans();},
    removeScan:async(id:string)=>commit(c=>({...c,scans:c.scans.filter(s=>s.id!==id)})),
    retryScan:async(id:string)=>{await commit(c=>({...c,scans:c.scans.map(s=>s.id===id?{...s,id:crypto.randomUUID(),jobId:undefined,error:undefined}:s)}));void runScans();},
    addPhoto:async(draft:PhysiqueDraft)=>{await commit(c=>({...c,photoDrafts:[...(c.photoDrafts??[]),draft]}));void runScans();},
    retryPhoto:async(id:string)=>{await commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).map(p=>p.id===id?{...p,id:/expired|deleted/i.test(p.error??'')?crypto.randomUUID():p.id,error:undefined}:p)}));void runScans();},
    removePhotoDraft:async(id:string)=>commit(c=>({...c,photoDrafts:(c.photoDrafts??[]).filter(p=>p.id!==id)})),
  };
}
export type Nourish=ReturnType<typeof useNourish>;


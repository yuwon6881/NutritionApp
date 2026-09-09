import {useCallback,useEffect,useRef,useState} from 'react';
import type {CoachPreview,Profile,ProfileDraft} from './types';
import type {Nourish} from './useNourish';
import {api,ApiError} from './lib/api';
import {profilesEqual} from './lib/profile';

export type CoachProposal=CoachPreview&{acceptId:string};
export type ProposalOperation='idle'|'waiting'|'calculating'|'updating'|'accepting'|'refreshing'|'error'|'refresh-error';
type AcceptedHandler=(refreshed:boolean)=>void|Promise<void>;

export function useCoachProposal({store,draft,changed=false,onAccepted}:{
  store:Nourish;
  draft?:Profile|ProfileDraft|null;
  changed?:boolean;
  onAccepted?:AcceptedHandler;
}){
  const [proposal,setProposalState]=useState<CoachProposal>();
  const [operation,setOperation]=useState<ProposalOperation>('idle');
  const [error,setError]=useState('');
  const [wantsProposal,setWantsProposal]=useState(false);
  const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine);
  const request=useRef(0);
  const locked=useRef(false);
  const calculating=useRef(false);
  const acceptance=useRef<{id:string;revision:number}|undefined>(undefined);
  const alive=useRef(true);
  const latest=useRef(store);
  const draftRef=useRef<typeof draft>(draft);
  const changedRef=useRef(changed);
  const acceptedRef=useRef(onAccepted);
  const proposalRef=useRef<CoachProposal|undefined>(undefined);
  latest.current=store;
  draftRef.current=draft;
  changedRef.current=changed;
  acceptedRef.current=onAccepted;

  const setProposal=useCallback((next:CoachProposal|undefined)=>{
    proposalRef.current=next;
    setProposalState(next);
  },[]);

  useEffect(()=>{
    alive.current=true;
    const connection=()=>setOnline(navigator.onLine);
    window.addEventListener('online',connection);window.addEventListener('offline',connection);
    return()=>{alive.current=false;++request.current;window.removeEventListener('online',connection);window.removeEventListener('offline',connection);};
  },[]);

  const invalidate=useCallback(()=>{
    ++request.current;calculating.current=false;setProposal(undefined);setWantsProposal(false);
    if(!locked.current)setOperation('idle');
  },[setProposal]);

  const loadProposal=useCallback(async()=>{
    if(locked.current||calculating.current)return;
    calculating.current=true;
    const token=++request.current;
    const revision=latest.current.state!.revision;
    setOperation('calculating');setError('');setProposal(undefined);
    try{
      const next=await api<CoachPreview>('/coach/preview');
      if(!alive.current||token!==request.current)return;
      if(next.revision!==latest.current.state!.revision){
        await latest.current.refresh();
        if(!alive.current||token!==request.current)return;
        setWantsProposal(true);setOperation('waiting');return;
      }
      const currentDraft=draftRef.current;
      const draftChanged=currentDraft!=null&&!profilesEqual(currentDraft as ProfileDraft,latest.current.state!.profile);
      if(latest.current.state!.revision!==revision||changedRef.current||draftChanged||!!latest.current.local?.queue.length){
        setWantsProposal(true);setOperation('waiting');return;
      }
      setProposal({...next,acceptId:crypto.randomUUID()});setOperation('idle');
    }catch(ex){if(alive.current&&token===request.current){setError((ex as Error).message);setOperation('error');}}
    finally{if(token===request.current)calculating.current=false;}
  },[setProposal]);

  const pending=Boolean(store.local?.queue.length);
  useEffect(()=>{
    if(wantsProposal&&!pending&&!changed&&online){
      setWantsProposal(false);
      void loadProposal();
    }
  },[wantsProposal,pending,changed,online,loadProposal]);

  const acceptProposal=useCallback(async()=>{
    const current=latest.current;
    let live=proposalRef.current;
    if(!live||locked.current||current.local?.queue.length||!online)return;
    locked.current=true;setError('');
    const token=++request.current;
    try{
      if(!acceptance.current&&live.revision!==current.state!.revision){
        setOperation('updating');
        live={...await api<CoachPreview>('/coach/preview'),acceptId:live.acceptId};
        if(!alive.current||token!==request.current)return;
        if(live.revision!==latest.current.state!.revision){
          await latest.current.refresh();
          if(!alive.current||token!==request.current)return;
          locked.current=false;setProposal(undefined);setWantsProposal(true);setOperation('waiting');return;
        }
        setProposal(live);
        if(!live.canAccept){setOperation('idle');return;}
      }
      const currentDraft=draftRef.current;
      if(latest.current.local?.queue.length||changedRef.current||
        (currentDraft!=null&&!profilesEqual(currentDraft as ProfileDraft,latest.current.state!.profile))){
        setProposal(undefined);setWantsProposal(true);setOperation('waiting');return;
      }
      setOperation('accepting');
      acceptance.current??={id:live.acceptId,revision:live.revision};
      await api('/coach/accept',acceptance.current);
      acceptance.current=undefined;
      if(!alive.current)return;
      setProposal(undefined);setOperation('refreshing');
      try{
        await latest.current.refresh();
        if(alive.current){setOperation('idle');await acceptedRef.current?.(true);}
      }catch{
        if(alive.current){await acceptedRef.current?.(false);setError('Your plan is active. The latest view could not be loaded.');setOperation('refresh-error');}
      }
    }catch(ex){
      if(ex instanceof ApiError&&[400,409,422].includes(ex.status))acceptance.current=undefined;
      if(ex instanceof ApiError&&ex.status===409&&alive.current&&token===request.current){
        try{
          await latest.current.refresh();
          if(alive.current&&token===request.current){locked.current=false;setProposal(undefined);setWantsProposal(true);setOperation('waiting');}
          return;
        }catch{/* Keep the failed proposal reviewable when refresh is unavailable. */}
      }
      if(alive.current&&token===request.current){setError(acceptance.current?'Activation could not be confirmed. Retry accepting this plan to check the same request.':(ex as Error).message);setOperation('error');}
    }finally{locked.current=false;}
  },[online,setProposal]);

  const retryRefresh=useCallback(async()=>{
    if(locked.current)return;
    locked.current=true;setOperation('refreshing');setError('');
    try{await latest.current.refresh();if(alive.current)setOperation('idle');}
    catch{if(alive.current){setError('Your plan is active. The latest view could not be loaded.');setOperation('refresh-error');}}
    finally{locked.current=false;}
  },[]);

  return {proposal,operation,setOperation,error,setError,setProposal,wantsProposal,setWantsProposal,loadProposal,acceptProposal,retryRefresh,
    invalidate,acceptance,locked,online,pending,busy:['calculating','updating','accepting','refreshing'].includes(operation)};
}

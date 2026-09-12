import {useEffect,useRef,useState} from 'react';
import type {EnergyUnit} from '../types';
import type {Nourish} from '../useNourish';
import {api} from '../lib/api';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {CoachNumber,CoachWait} from './ui/CoachMotion';
import {useReducedMotion} from './ui/Motion';
import {useCoachProposal} from '../useCoachProposal';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {useAsyncAction} from './ui/useAsyncAction';

export interface CheckInDialogProps {
  open:boolean;
  store:Nourish;
  onClose:()=>void;
  restoreFocus?:HTMLElement|null;
}

function CalorieChange({previous,proposed,unit}:{previous:number|null|undefined;proposed:number|null|undefined;unit:EnergyUnit}){
  const reduced=useReducedMotion();
  const hasValues=previous!=null&&proposed!=null;
  const delta=hasValues?proposed-previous:0;
  const [revealed,setRevealed]=useState(!hasValues||reduced);

  useEffect(()=>{
    if(!hasValues||reduced){setRevealed(true);return;}
    setRevealed(false);
    const timer=window.setTimeout(()=>setRevealed(true),520);
    return()=>window.clearTimeout(timer);
  },[hasValues,previous,proposed,reduced]);

  const value=revealed?(proposed??previous):(previous??proposed);
  const direction=delta>0?'positive':delta<0?'negative':'neutral';
  const copy=delta>0
    ?`Add ${displayEnergy(delta,unit)} ${energyLabel(unit)}`
    :delta<0
    ?`Deduct ${displayEnergy(Math.abs(delta),unit)} ${energyLabel(unit)}`
    :'Unchanged';
  return <div className={`check-in-calorie ${revealed?'is-revealed':''}`} data-check-in-calorie aria-live="polite">
    <span className="check-in-calorie-label">{revealed?'New daily calories':'Current daily calories'}</span>
    <div className="check-in-calorie-value" aria-label={`${displayEnergy(value,unit)} ${energyLabel(unit)}`}>
      <CoachNumber>{displayEnergy(value,unit)}</CoachNumber><span className="unit">{energyLabel(unit)}</span>
    </div>
    {hasValues&&<span className={`check-in-calorie-delta ${revealed?direction:'pending'}`} aria-hidden={!revealed}>
      <span aria-hidden="true">{delta>0?'↑':delta<0?'↓':'→'}</span>{revealed?copy:''}
    </span>}
  </div>;
}

export function CheckInDialog({open,store,onClose,restoreFocus}:CheckInDialogProps){
  const {busy:declining,run:runDecline}=useAsyncAction();
  const [declineError,setDeclineError]=useState('');
  const declineId=useRef<string|undefined>(undefined);
  const proposalFlow=useCoachProposal({store,onAccepted:onClose});
  const {proposal,operation,error,setError,loadProposal,acceptProposal,acceptance,online,pending}=proposalFlow;

  useEffect(()=>{
    if(!open)return;
    setDeclineError('');setError('');
    void loadProposal();
  },[open,loadProposal,setError]);

  const decline=async()=>{
    if(!proposal||declining||!online||pending)return;
    setDeclineError('');
    const id=declineId.current??crypto.randomUUID();declineId.current=id;
    try{
      await runDecline(async()=>{
        await api('/coach/decline',{id,revision:proposal.revision});
        declineId.current=undefined;
        try{await store.refresh();}catch{/* The server decision is durable even if the refresh is delayed. */}
      });
      onClose();
    }catch(ex){setDeclineError((ex as Error).message);}
  };

  const result=proposal?.result;
  const changes=proposal?.changes;
  const units=unitsFor(store.state?.settings);
  const busy=['calculating','updating','accepting','refreshing'].includes(operation)||declining;
  return <Modal open={open} onClose={onClose} restoreFocus={restoreFocus} width="md" title="Weekly check-in">
    {!proposal?<div className="check-in-loading" role={error?'alert':'status'}>
      <p>{error||operation==='error'?'Could not prepare this check-in yet.':operation==='refresh-error'?'Your plan is active. The latest view could not be loaded.':'Preparing your check-in…'}</p>
      {operation==='calculating'&&<CoachWait label="Calculating calories…" active/>}
      {operation==='refreshing'&&<CoachWait label="Refreshing calories…" active/>}
      {error&&<Button onClick={()=>void loadProposal()} disabled={!online||pending}>Retry</Button>}
    </div>:<div className="check-in-dialog-content">
      <CalorieChange previous={changes?.previousCalories} proposed={changes?.proposedCalories??result?.calories} unit={units.energy}/>
      {(error||declineError)&&<p className="error" role="alert">{error||declineError}</p>}
      <div className="modal-actions">
        <Button variant="primary" disabled={busy||!online||pending||!proposal.canAccept||!!acceptance.current} onClick={()=>void acceptProposal()}>
          {operation==='accepting'?'Accepting…':'Accept'}
        </Button>
        <Button variant="secondary" disabled={busy||!online||pending||!!acceptance.current} onClick={()=>void decline()}>
          {declining?'Declining…':'Decline'}
        </Button>
      </div>
    </div>}
  </Modal>;
}

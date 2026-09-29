import {useEffect,useRef,useState} from 'react';
import type {Nourish} from '../useNourish';
import {api} from '../lib/api';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {CoachWait} from './ui/CoachMotion';
import {useCoachProposal} from '../useCoachProposal';
import {unitsFor} from '../lib/units';
import {CheckInCalorieChange} from './CheckInCalorieChange';
import {contextAdjustmentSummary} from '../lib/weighInEvidence';
import {useAsyncAction} from './ui/useAsyncAction';

export interface CheckInDialogProps {
  open:boolean;
  store:Nourish;
  onClose:()=>void;
  restoreFocus?:HTMLElement|null;
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
  const adjusted=contextAdjustmentSummary(proposal?.evidence??result?.evidence);
  const busy=['calculating','updating','accepting','refreshing'].includes(operation)||declining;
  return <Modal open={open} onClose={onClose} restoreFocus={restoreFocus} width="md" title="Weekly check-in">
    {!proposal?<div className="check-in-loading" role={error?'alert':'status'}>
      <p>{error||operation==='error'?'Could not prepare this check-in yet.':operation==='refresh-error'?'Your plan is active. The latest view could not be loaded.':'Preparing your check-in…'}</p>
      {operation==='calculating'&&<CoachWait label="Calculating calories…" active/>}
      {operation==='refreshing'&&<CoachWait label="Refreshing calories…" active/>}
      {error&&<Button onClick={()=>void loadProposal()} disabled={!online||pending}>Retry</Button>}
    </div>:<div className="check-in-dialog-content">
      <CheckInCalorieChange previous={changes?.previousCalories} proposed={changes?.proposedCalories??result?.calories} unit={units.energy}/>
      {adjusted&&<p className="check-in-context source">{adjusted}</p>}
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

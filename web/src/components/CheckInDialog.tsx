import {useEffect,useRef,useState} from 'react';
import type {Nourish} from '../useNourish';
import {api} from '../lib/api';
import {number} from '../lib/format';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {CoachDelta,CoachNumber} from './ui/CoachMotion';
import {useCoachProposal} from '../useCoachProposal';
import {displayEnergy,energyLabel,energyValue,unitsFor} from '../lib/units';
import {useAsyncAction} from './ui/useAsyncAction';

const goalLabel=(goal?:string)=>goal==='lose'?'Fat loss':goal==='gain'?'Bulking':goal==='maintain'?'Maintenance':'Starting plan';

export interface CheckInDialogProps {
  open:boolean;
  store:Nourish;
  onClose:()=>void;
  restoreFocus?:HTMLElement|null;
}

function ChangeRow({label,previous,proposed,unit='',formatValue=number,deltaValue=(value:number)=>value}:{label:string;previous:number|null|undefined;proposed:number|null|undefined;unit?:string;formatValue?:(value:number|null|undefined)=>string;deltaValue?:(value:number)=>number}){
  const delta=previous==null||proposed==null?null:proposed-previous;
  return <div className="check-in-change" data-check-in-reveal>
    <span>{label}</span>
    <strong><CoachNumber>{formatValue(previous)}</CoachNumber> <span className="unit">{unit}</span> <span aria-hidden="true">→</span> <CoachNumber>{formatValue(proposed)}</CoachNumber> <span className="unit">{unit}</span></strong>
    {delta!=null&&<CoachDelta value={deltaValue(delta)} unit={unit||'kcal'}/>}
  </div>;
}

export function CheckInDialog({open,store,onClose,restoreFocus}:CheckInDialogProps){
  const {busy:declining,run:runDecline}=useAsyncAction();
  const [declineError,setDeclineError]=useState('');
  const declineId=useRef<string|undefined>(undefined);
  const source=useRef<HTMLDivElement>(null);
  const proposalFlow=useCoachProposal({store,onAccepted:onClose});
  const {proposal,operation,error,setError,loadProposal,acceptProposal,acceptance,online,pending}=proposalFlow;

  useEffect(()=>{
    if(!open)return;
    setDeclineError('');setError('');
    void loadProposal();
  },[open,loadProposal,setError]);

  useEffect(()=>{
    if(!open||!proposal||!source.current)return;
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    let animations:Animation[]=[];
    const stop=()=>{if(preference.matches)animations.forEach(animation=>animation.cancel());};
    if(preference.matches){preference.addEventListener('change',stop);return()=>preference.removeEventListener('change',stop);}
    const items=[...source.current.querySelectorAll<HTMLElement>('[data-check-in-reveal]')];
    const computed=getComputedStyle(source.current);
    const easing=computed.getPropertyValue('--coach-ease').trim()||'cubic-bezier(.2,.8,.2,1)';
    const duration=Number.parseFloat(computed.getPropertyValue('--coach-short'))||160;
    animations=items.map((item,index)=>item.animate(
      [{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],
      {delay:index*35,duration,easing,fill:'both'}));
    preference.addEventListener('change',stop);
    return()=>{animations.forEach(animation=>animation.cancel());preference.removeEventListener('change',stop);};
  },[open,proposal]);

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
  const evidence=proposal?.evidence??result?.evidence;
  const units=unitsFor(store.state?.settings);
  const energyUnit=energyLabel(units.energy);
  const busy=['calculating','updating','accepting','refreshing'].includes(operation)||declining;
  return <Modal open={open} onClose={onClose} restoreFocus={restoreFocus} width="lg"
    title="Weekly check-in" description="Review what this week’s evidence would change before you decide.">
    {!proposal?<div className="check-in-loading" role={error?'alert':'status'}>
      <p>{error||operation==='error'?'Could not prepare this check-in yet.':operation==='refresh-error'?'Your plan is active. The latest view could not be loaded.':'Preparing your weekly evidence…'}</p>
      {error&&<Button onClick={()=>void loadProposal()} disabled={!online||pending}>Retry</Button>}
    </div>:<div className="check-in-dialog-content">
      <div ref={source} className="check-in-changes" aria-label="Target changes">
        <ChangeRow label="Daily energy" previous={changes?.previousCalories} proposed={changes?.proposedCalories??result?.calories} unit={energyUnit} formatValue={value=>displayEnergy(value,units.energy)} deltaValue={value=>energyValue(value,units.energy)??value}/>
        <ChangeRow label="Maintenance" previous={changes?.previousExpenditure} proposed={changes?.proposedExpenditure??result?.expenditure} unit={energyUnit} formatValue={value=>displayEnergy(value,units.energy)} deltaValue={value=>energyValue(value,units.energy)??value}/>
        <ChangeRow label="Protein" previous={changes?.previousProtein} proposed={changes?.proposedProtein??result?.protein} unit="g"/>
        <ChangeRow label="Carbohydrate" previous={changes?.previousCarbs} proposed={changes?.proposedCarbs??result?.carbs} unit="g"/>
        <ChangeRow label="Fat" previous={changes?.previousFat} proposed={changes?.proposedFat??result?.fat} unit="g"/>
        <div className="check-in-goal-change" data-check-in-reveal>
          <span>Direction</span>
          <strong>{goalLabel(changes?.previousEffectiveGoal)} <span aria-hidden="true">→</span> {goalLabel(changes?.proposedEffectiveGoal??result?.effectiveGoal)}</strong>
        </div>
      </div>
      <section className="check-in-weekly-program" data-check-in-reveal aria-labelledby="check-in-weekly-title">
        <h3 id="check-in-weekly-title">Proposed weekly schedule</h3>
        <p className="source">{result?.goalRatePercent==null?'Rate not available':`Goal rate: ${result.goalRatePercent}% bodyweight per week`} · Weekly budget: {displayEnergy(result?.weeklyCalories,units.energy)} {energyUnit}</p>
        <div className="check-in-daily-targets">{(result?.dailyCalories??[]).map((calories,index)=><div key={index}><span>{['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][index]}</span><strong>{displayEnergy(calories,units.energy)} {energyUnit}</strong></div>)}</div>
        {!result?.dailyCalories&&<p className="notice">This older plan has one average daily target; it remains unchanged unless you accept this proposal.</p>}
      </section>
      <div className="source check-in-evidence" data-check-in-reveal>
        <strong>Evidence</strong>
        {evidence&&<>
          <span>{evidence.loggedDays} of {evidence.windowDays} days logged; unlogged days are excluded and may bias this estimate.</span>
          <span>{evidence.weighIns} retained weigh-ins spanning {evidence.weighInSpanDays} days.</span>
          <span>{evidence.waterFlaggedDays} possible water or level-shift days flagged and excluded.</span>
          <span>Confidence-weighted update: {Math.round(evidence.confidence*100)}% evidence confidence.</span>
        </>}
        <span>{result?.explanation}</span>
      </div>
      {(error||declineError)&&<p className="error" role="alert">{error||declineError}</p>}
      <div className="modal-actions">
        <Button variant="primary" disabled={busy||!online||pending||!proposal.canAccept||!!acceptance.current} onClick={()=>void acceptProposal()}>
          {operation==='accepting'?'Accepting…':'Accept new targets'}
        </Button>
        <Button variant="secondary" disabled={busy||!online||pending||!!acceptance.current} onClick={()=>void decline()}>
          {declining?'Saving…':'Not now'}
        </Button>
      </div>
    </div>}
  </Modal>;
}

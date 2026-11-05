import {useRef,useState} from 'react';
import type {GoalProgress} from '../types';
import type {NutritionStore} from '../useNutritionStore';
import {api} from '../lib/api';
import {displayWeight,unitsFor,weightLabel} from '../lib/units';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {useAsyncAction} from './ui/useAsyncAction';

const goalTitle=(goal:string|undefined)=>goal==='gain'?'Bulking':goal==='lose'?'Fat loss':'Maintenance';

/** True while a reached goal still waits for the user's explicit completion decision. */
export function goalNeedsDecision(progress:GoalProgress|null|undefined,metric:'scale'|'trend'){
  if(!progress||progress.complete)return false;
  const trendReached=progress.trendReached===true;
  const scaleReached=progress.scaleReached===true;
  const awaiting=(progress.awaitingTrend===true||(metric==='trend'&&scaleReached))&&!trendReached;
  if(awaiting)return false;
  return progress.durationReached===true||(metric==='trend'?trendReached:(scaleReached||trendReached));
}

/**
 * Opened from the Dashboard's goal-complete ring. It says the goal is achieved, records the
 * explicit decision, then hands over to Coach to choose the next plan.
 */
export function GoalReachedDialog({open,progress,store,onClose,onChooseGoal}:{
  open:boolean;
  progress:GoalProgress|null|undefined;
  store:NutritionStore;
  onClose:()=>void;
  onChooseGoal:()=>void;
}){
  const {run,pending}=useAsyncAction();
  const [error,setError]=useState('');
  const [trendStep,setTrendStep]=useState(false);
  const [rememberChoice,setRememberChoice]=useState(true);
  const decisionId=useRef<string|undefined>(undefined);
  const settings=store.state?.settings;
  const units=unitsFor(settings);
  const shown=(value:number|null|undefined)=>`${displayWeight(value,units.weight,1)} ${weightLabel(units.weight)}`;
  if(!progress)return null;
  const scaleOnly=progress.scaleReached===true&&progress.trendReached!==true&&progress.durationReached!==true;

  const decide=async(decision:'completed'|'await-trend')=>{
    if(pending)return;
    setError('');
    const id=decisionId.current??crypto.randomUUID();decisionId.current=id;
    try{
      await run(async()=>{
        await api('/goal/complete',{id,revision:store.state!.revision,decision});
        decisionId.current=undefined;
        await store.refresh();
      });
      setTrendStep(false);
      onClose();
      if(decision==='completed')onChooseGoal();
    }catch(ex){setError((ex as Error).message);}
  };

  const waitForTrend=()=>{
    if(rememberChoice&&settings){
      void store.mutate({kind:'settings',recordId:store.state!.id,expectedRevision:settings.revision,data:{weightGoalMetric:'trend'},delete:false});
    }
    void decide('await-trend');
  };

  return <Modal open={open} onClose={trendStep?()=>setTrendStep(false):onClose} width="sm" title={trendStep?'Wait for trend weight':'Goal achieved'}>
    <div className="goal-trend-modal-content">
      {trendStep
        ?<p>Waiting for trend weight keeps short-term water fluctuations from ending your goal phase prematurely until smoothed trend weight reaches your target.</p>
        :<p>{goalTitle(progress.goal)} goal reached. Complete this goal, then choose your next plan in Coach. Until you do, your current targets stay in place.</p>}
      <p className="source">{progress.mode==='duration'?'Your planned phase duration has elapsed.':`Scale ${shown(progress.scaleWeight)} · Trend ${shown(progress.trendWeight)} · Target ${shown(progress.targetWeight)}`}</p>
      {trendStep&&<label className="check-row"><input type="checkbox" checked={rememberChoice} onChange={event=>setRememberChoice(event.target.checked)}/><span>Remember my choice (use trend weight for future weight goals)</span></label>}
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        {trendStep
          ?<><Button variant="primary" disabled={pending} onClick={waitForTrend}>Wait for trend weight</Button><Button variant="secondary" disabled={pending} onClick={()=>setTrendStep(false)}>Back</Button></>
          :<><Button variant="primary" disabled={pending} onClick={()=>void decide('completed')}>Complete goal</Button>{scaleOnly&&<Button variant="secondary" disabled={pending} onClick={()=>setTrendStep(true)}>Wait for trend weight</Button>}</>}
      </div>
    </div>
  </Modal>;
}

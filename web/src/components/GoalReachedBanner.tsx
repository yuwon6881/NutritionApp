import {useRef,useState} from 'react';
import {Flag} from 'lucide-react';
import type {GoalProgress} from '../types';
import type {Nourish} from '../useNourish';
import {api} from '../lib/api';
import {displayWeight,unitsFor,weightLabel} from '../lib/units';
import {Button} from './ui/Button';
import {useAsyncAction} from './ui/useAsyncAction';

export function GoalReachedBanner({progress,onChooseGoal,action='Choose your next goal',store,onComplete}: {
  progress:GoalProgress|null|undefined;
  onChooseGoal:()=>void;
  action?:string;
  store?:Nourish;
  onComplete?:(trigger:HTMLElement)=>void;
}){
  const {busy,run}=useAsyncAction();
  const [error,setError]=useState('');
  const decisionId=useRef<string|undefined>(undefined);
  if(!progress)return null;
  const title=progress.goal==='gain'?'Bulking':progress.goal==='lose'?'Fat loss':'Maintenance';
  const trendReached=progress.trendReached===true;
  const scaleReached=progress.scaleReached===true;
  const durationReached=progress.durationReached===true;
  const reached=durationReached||scaleReached||trendReached;
  const awaiting=progress.awaitingTrend===true&&!trendReached&&!progress.complete;
  const scaleOnly=scaleReached&&!trendReached&&!durationReached&&!awaiting;
  const units=unitsFor(store?.state?.settings);
  const weightUnit=weightLabel(units.weight);
  const shownWeight=(value:number|null|undefined,digits=1)=>`${displayWeight(value,units.weight,digits)} ${weightUnit}`;
  const decide=async(decision:'completed'|'await-trend',trigger:HTMLElement)=>{
    if(!store||busy)return;
    setError('');
    const id=decisionId.current??crypto.randomUUID();decisionId.current=id;
    try{
      await run(async()=>{
        await api('/goal/complete',{id,revision:store.state!.revision,decision});
        decisionId.current=undefined;
        await store.refresh();
      });
      if(decision==='completed')onComplete?.(trigger);
    }catch(ex){setError((ex as Error).message);}
  };

  if(awaiting)
    return <p className="notice goal-awaiting-trend">Waiting for trend weight · Scale {shownWeight(progress.scaleWeight)} · Trend {shownWeight(progress.trendWeight)} · Target {shownWeight(progress.targetWeight)}</p>;
  if(!progress.complete&&!reached)return null;
  if(progress.complete)return <section className="panel goal-reached-banner" aria-labelledby="goal-reached-title">
    <div className="goal-reached-mark" aria-hidden="true"><Flag size={20}/></div>
    <div>
      <h2 id="goal-reached-title">{title} phase complete</h2>
      {progress.mode==='weight'&&<p>Start {shownWeight(progress.startWeight)} · now {shownWeight(progress.trendWeight)} · target {shownWeight(progress.targetWeight)}.</p>}
    </div>
    <Button variant="primary" size="md" onClick={onChooseGoal}>{action}</Button>
  </section>;

  return <>
    <section className="panel goal-reached-banner" aria-labelledby="goal-reached-title">
      <div className="goal-reached-mark" aria-hidden="true"><Flag size={20}/></div>
      <div>
        <h2 id="goal-reached-title">{title} goal reached</h2>
        {progress.mode==='weight'&&<p>Scale {shownWeight(progress.scaleWeight)} · Trend {shownWeight(progress.trendWeight)} · Target {shownWeight(progress.targetWeight)}</p>}
        {progress.mode==='duration'&&<p>Your planned phase duration has elapsed.</p>}
      </div>
      <div className="goal-reached-actions">
        <Button variant="primary" size="md" disabled={busy||!store} onClick={event=>void decide('completed',event.currentTarget)}>Complete goal</Button>
        {scaleOnly&&<Button variant="secondary" size="md" disabled={busy||!store} onClick={event=>void decide('await-trend',event.currentTarget)}>Wait for trend weight</Button>}
      </div>
    </section>
    {error&&<p className="error" role="alert">{error}</p>}
  </>;
}

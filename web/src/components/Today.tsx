import {useState} from 'react';
import {ArrowRight,Plus,Copy,Leaf,Scale} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {CoachResult,Entry} from '../types';
import {number,today} from '../lib/format';
import {Button} from './ui/Button';
import {SelectField} from './ui/Field';
import {DatePicker} from './ui/DatePicker';
import {dayStatus} from '../lib/loggingDay';
import {liveGoalProgress,mergeGoalProgress} from '../lib/goalProgress';
import {targetsForDate} from '../lib/dailyTargets';
import {GoalReachedBanner} from './GoalReachedBanner';
import {CheckInCard} from './CheckInCard';
import {CheckInDialog} from './CheckInDialog';
import {mealReadOnly,moveEntry} from '../lib/foodDiary';
import {FoodTimeline} from './FoodTimeline';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
export function Today({
  store,
  date,
  setDate,
  onLog,
  onCoach,
  onEdit,
  onWeight,
  onCopyDay
}:{
  store:Nourish;
  date:string;
  setDate:(v:string)=>void;
  onLog:()=>void;
  onCoach:()=>void;
  onEdit:(e:Entry)=>void;
  onWeight:(trigger?:HTMLElement|null)=>void;
  onCopyDay:(sourceDate:string,entries:Entry[],trigger?:HTMLElement|null)=>void;
}){
  const state=store.state!;
  const energyUnit=unitsFor(state.settings).energy;
  const [error,setError]=useState('');
  const [checkInOpen,setCheckInOpen]=useState(false);
  const [checkInRestore,setCheckInRestore]=useState<HTMLElement|null>(null);
  const entries=state.entries.filter(e=>!e.deleted&&e.date===date);
  const savedDay=state.days.find(d=>d.date===date&&!d.deleted);
  const total=savedDay?.archived?(savedDay.calories??0):entries.reduce((s,e)=>s+e.calories,0);
  const readOnly=mealReadOnly(state,date);
  // Keep the latest accepted targets active while a newer profile proposal is
  // waiting for an explicit acceptance.
  const accepted=state.plans.find(p=>!p.deleted);
  const latestPlan:CoachResult|undefined=accepted?JSON.parse(accepted.resultJson):undefined;
  // Use historical target intervals when browsing past dates so the diary shows
  // the targets that were active at that time, not the current plan.
  const intervals=state.acceptedTargetIntervals??[];
  const historicalInterval=intervals.find(i=>i.start<=date&&i.end>=date);
  const plan:CoachResult|undefined=historicalInterval
    ?{version:latestPlan?.version??'2.0.0',eligible:true,adaptive:false,calories:historicalInterval.calories,expenditure:null,protein:latestPlan?.protein??null,fat:latestPlan?.fat??null,carbs:latestPlan?.carbs??null,explanation:'',weeklyCalories:historicalInterval.weeklyCalories,dailyCalories:historicalInterval.dailyCalories,proteinFixed:latestPlan?.proteinFixed}
    :latestPlan;
  const targets=targetsForDate(plan,date);
  const day=state.days.find(d=>d.date===date);
  const status=dayStatus(date,today(state.profile?.timeZone),day&&!day.deleted?day.status:undefined,savedDay?.archived?(savedDay.entryCount??0)>0:entries.length>0);
  const ratio=targets.calories?Math.min(total/targets.calories,1):0;
  const act=async(fn:()=>Promise<unknown>)=>{try{setError('');await fn();}catch(ex){setError((ex as Error).message);}};
  const phaseDecision=state.phaseDecisions?.find(decision=>decision.profileRevision===state.profileRevision&&!decision.deleted);
  const goalProgress=mergeGoalProgress(latestPlan?.goalProgress,liveGoalProgress(state.profile,[...(state.weightTrendSeed??[]),...state.weights.filter(w=>!w.deleted)],today(state.profile?.timeZone),phaseDecision),phaseDecision);
  const loaded=date>=state.start&&date<=state.end;
  return <>
    <header className="page-heading">
      <div>

        <h1 data-page-heading tabIndex={-1}>Diary</h1>

      </div>
      <div className="page-heading-actions">
        <Button variant="secondary" onClick={event=>onWeight(event.currentTarget)}>
          <Scale size={18}/>
          <span>Log weight</span>
        </Button>
        <DatePicker id="diary-date" name="date" label="Diary date" value={date} max={today(state.profile?.timeZone)} onChange={val=>{
          setDate(val);
          if(val<state.start||val>state.end)void store.refresh(val).catch(ex=>setError(ex.message));
        }}/>
      </div>
    </header>
    <GoalReachedBanner progress={goalProgress} store={store} onChooseGoal={onCoach} action="Open coach"
      onComplete={trigger=>{setCheckInRestore(trigger);setCheckInOpen(true);}}/>
    <CheckInCard store={store} onReview={trigger=>{setCheckInRestore(trigger);setCheckInOpen(true);}}/>
    {!loaded?<section className="panel">
      <h2>Not stored on this device</h2>
      <p>Connect to load this date.</p>
    </section>:<>
      <section className="daily-grid">
        <article className="panel energy-panel">
          <div>
            <p className="eyebrow">ENERGY</p>
            <h2>{displayEnergy(total,energyUnit)} <span className="unit">{energyLabel(energyUnit)} logged</span></h2>
            <p>{targets.calories?`${displayEnergy(targets.calories,energyUnit)} ${energyLabel(energyUnit)} target`:'Set up your coach'}</p>
            <Button variant="tertiary" onClick={onCoach}>
              {latestPlan?'Targets':'Set up coach'}<ArrowRight size={16}/>
            </Button>
          </div>
          <svg className="energy-ring" viewBox="0 0 120 120" role="img" aria-label={targets.calories?`${displayEnergy(total,energyUnit)} of ${displayEnergy(targets.calories,energyUnit)} ${energyLabel(energyUnit)} logged`:`${displayEnergy(total,energyUnit)} ${energyLabel(energyUnit)} logged`}>
            <circle className="ring-track" cx="60" cy="60" r="48"/>
            <circle className="ring-fill" cx="60" cy="60" r="48" strokeDasharray={`${ratio*301.59} 301.59`} transform="rotate(-90 60 60)"/>
            <text x="60" y="58" textAnchor="middle">{targets.calories?displayEnergy(Math.max(targets.calories-total,0),energyUnit):'—'}</text>
            <text className="ring-label" x="60" y="76" textAnchor="middle">{total>(targets.calories??Infinity)?'target reached':'remaining'}</text>
          </svg>
        </article>
        <article className="panel macros">
          <p className="eyebrow">MACRONUTRIENTS</p>
          {(['protein','carbs','fat'] as const).map(key=>{
            const known=entries.filter(e=>e[key]!=null);
            const sum=savedDay?.archived?(savedDay[key]??0):known.reduce((s,e)=>s+e[key]!,0);
            const incomplete=savedDay?.archived?savedDay[key]==null:known.length!==entries.length;
            return <div className={'macro '+key} key={key}>
              <span>{key==='carbs'?'Carbohydrate':key[0].toUpperCase()+key.slice(1)}</span>
              <strong>{savedDay?.archived&&savedDay[key]==null?'—':entries.length&&!known.length?'—':number(sum)}<small> / {number(targets[key])} g{incomplete?' · partial':''}</small></strong>
              <progress aria-label={`${key} logged`} value={sum} max={Math.max(targets[key]??sum,1)}/>
            </div>;
          })}
        </article>
      </section>
      <section className="panel diary">
        <div className="section-heading">
          <div>
            <h2>{savedDay?.archived?"Daily summary":"Food entries"}</h2>
            <small className="source">{status==='complete'?'Complete':status==='fasting'?'Fasting':status==='not_logged'?'Not logged':date===today(state.profile?.timeZone)?'Still logging':'No food logged'}</small>
            {date<today(state.profile?.timeZone)&&<SelectField id="diary-logging-status" name="status" label="Logging status" value={status==='fasting'||status==='not_logged'?status:'incomplete'} onChange={value=>void act(()=>store.mutate({kind:'day',recordId:day?.id??crypto.randomUUID(),expectedRevision:day?.revision??0,data:{date,status:value},delete:false}))}><option value="incomplete">{entries.length||(savedDay?.entryCount??0)>0?'Complete automatically':'No food logged'}</option><option value="not_logged">Not logging</option><option value="fasting" disabled={total>0}>Fasting</option></SelectField>}
          </div>
          <Button variant="primary" size="md" disabled={readOnly} onClick={onLog}>
            <Plus size={18}/>Log food
          </Button>
        </div>
        {savedDay?.archived?<div className="notice">
          <h3>{displayEnergy(savedDay.calories,energyUnit)} {energyLabel(energyUnit)} · {savedDay.entryCount} food entries</h3>
        </div>:!entries.length?<div className="empty">
          <Leaf size={30}/>
          <h3>No food entries</h3>
        </div>:<FoodTimeline store={store} date={date} entries={entries} readOnly={readOnly} onEdit={onEdit}
           onMove={(moving,time)=>void act(async()=>{for(const entry of moving){const op=moveEntry(entry,time);if(op)await store.mutate(op);}})}/>}
        {!!entries.length&&<div className="copy-day">
          <Button size="md" onClick={event=>onCopyDay(date,entries,event.currentTarget)}>
            <Copy size={16}/>Copy day
          </Button>
        </div>}
      </section>
    </>}
    {error&&<p className="error" role="alert">{error}</p>}
    <CheckInDialog open={checkInOpen} store={store} restoreFocus={checkInRestore} onClose={()=>setCheckInOpen(false)}/>
  </>;
}

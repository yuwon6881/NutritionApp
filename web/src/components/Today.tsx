import {useEffect,useMemo,useState} from 'react';
import type {NutritionStore} from '../useNutritionStore';
import type {CoachResult} from '../types';
import {number,today} from '../lib/format';
import {cleanTrend} from '../lib/weightSignal';
import {liveGoalProgress,mergeGoalProgress} from '../lib/goalProgress';
import {targetsForDate} from '../lib/dailyTargets';
import {GoalReachedBanner} from './GoalReachedBanner';
import {GoalSummary} from './GoalSummary';
import {CheckInButton} from './CheckInButton';
import {checkInSchedule} from '../lib/checkIn';
import {CheckInDialog} from './CheckInDialog';
import {displayEnergy,displayWeight,weightLabel,energyLabel,unitsFor} from '../lib/units';
import {shouldShowDashboardSteps,useGoogleHealth} from '../lib/googleHealth';
import {GoogleHealthStepsCard} from './GoogleHealthStepsCard';
import {StepCalorieCalculator} from './StepCalorieCalculator';
import {TrainingSummaryCard} from './TrainingSummaryCard';
import {EnergyRing} from './EnergyRing';
import {MotionPanel} from './ui/Motion';

// The landing cascade plays once per launch; returning to the Dashboard uses the page transition only.
let dashboardIntroPlayed=false;

export function Today({store,onCoach,onSettings}:{store:NutritionStore;onCoach:()=>void;onSettings?:()=>void}){
  const state=store.state!;
  const date=today(state.profile?.timeZone);
  // The same cleaned trend the coach uses: marked temporary days and statistical outliers stay out.
  const latestWeight=useMemo(()=>cleanTrend([...(state.weightTrendSeed??[]),...state.weights.filter(w=>!w.deleted)],date).at(-1),[state.weightTrendSeed,state.weights,date]);
  const energyUnit=unitsFor(state.settings).energy;
  const [checkInOpen,setCheckInOpen]=useState(false);
  const [intro]=useState(()=>!dashboardIntroPlayed);
  useEffect(()=>{dashboardIntroPlayed=true;},[]);
  const [checkInRestore,setCheckInRestore]=useState<HTMLElement|null>(null);
  const entries=state.entries.filter(e=>!e.deleted&&e.date===date);
  const savedDay=state.days.find(d=>d.date===date&&!d.deleted);
  const total=savedDay?.archived?(savedDay.calories??0):entries.reduce((s,e)=>s+e.calories,0);
  // Keep the latest accepted targets active while a newer profile proposal is
  // waiting for an explicit acceptance.
  const accepted=state.plans.find(p=>!p.deleted);
  const latestPlan:CoachResult|undefined=accepted?JSON.parse(accepted.resultJson):undefined;
  // Use historical target intervals when browsing past dates so the diary shows
  // the targets that were active at that time, not the current plan.
  const intervals=state.acceptedTargetIntervals??[];
  const historicalInterval=intervals.find(i=>i.start<=date&&i.end>=date);
  const plan:CoachResult|undefined=historicalInterval
    ?{version:latestPlan?.version??'2.0.0',eligible:true,adaptive:false,calories:historicalInterval.calories,expenditure:null,
      protein:historicalInterval.protein!==undefined?historicalInterval.protein:latestPlan?.protein??null,
      fat:historicalInterval.fat!==undefined?historicalInterval.fat:latestPlan?.fat??null,
      carbs:historicalInterval.carbs!==undefined?historicalInterval.carbs:latestPlan?.carbs??null,explanation:'',weeklyCalories:historicalInterval.weeklyCalories,dailyCalories:historicalInterval.dailyCalories,
      proteinFixed:historicalInterval.proteinFixed!==undefined?historicalInterval.proteinFixed:latestPlan?.proteinFixed}
    :latestPlan;
  const targets=targetsForDate(plan,date);
  const phaseDecision=state.phaseDecisions?.find(decision=>decision.profileRevision===state.profileRevision&&!decision.deleted);
  const liveProgress=useMemo(()=>liveGoalProgress(state.profile,[...(state.weightTrendSeed??[]),...state.weights.filter(w=>!w.deleted)],date,phaseDecision,state.settings?.weightGoalMetric??'scale'),[state.profile,state.weightTrendSeed,state.weights,date,phaseDecision,state.settings?.weightGoalMetric]);
  const goalProgress=mergeGoalProgress(latestPlan?.goalProgress,liveProgress,phaseDecision);
  const loaded=date>=state.start&&date<=state.end;
  // A due check-in takes the ring's place: the target may change, so remaining calories stay
  // hidden until the check-in is accepted or declined, which recomputes the schedule.
  const checkIn=state.profile?checkInSchedule(state,date):undefined;
  const checkInReady=Boolean(checkIn?.due)&&loaded;
  const openCheckIn=(trigger:HTMLElement)=>{setCheckInRestore(trigger);setCheckInOpen(true);};
  const {state: ghState,loading: ghLoading}=useGoogleHealth();
  // Do not show an integration card while its first status request is unresolved.
  // Once a connection is known, keep the card visible during background refresh so
  // a temporary loading state does not make the dashboard jump.
  const showGoogleHealthSteps = shouldShowDashboardSteps(ghState,ghLoading);
  // Depend on the stable loader, not the store object: every commit returns a new store, so a
  // store dependency re-fetched after each response in an endless loop.
  const loadTrainingSummaries=store.loadTrainingSummaries;
  useEffect(()=>{if(state.workoutConnected!==false)void loadTrainingSummaries?.();},[loadTrainingSummaries,state.workoutConnected]);
  return <>
    <header className="page-heading"><h1 data-page-heading tabIndex={-1}>Dashboard</h1></header>
    <GoalReachedBanner progress={goalProgress} store={store} onChooseGoal={onCoach} action="Open coach"
      onComplete={openCheckIn}/>
    {!loaded?<section className="panel">
      <h2>Not stored on this device</h2>
      <p>Connect to load this date.</p>
    </section>:<>
      <div className={intro?'dashboard-cards dashboard-intro':'dashboard-cards'}>
      <section className="daily-grid">
        <article className="panel energy-panel">
          <div>
            <p className="eyebrow">ENERGY</p>
            <h2>{displayEnergy(total,energyUnit)} <span className="unit">{energyLabel(energyUnit)} logged</span></h2>
            <p>{checkInReady?"Review your check-in to see today's target":targets.calories?`${displayEnergy(targets.calories,energyUnit)} ${energyLabel(energyUnit)} target`:'Set up your coach'}</p>
          </div>
          {checkInReady&&checkIn
            ?<div className="energy-check-in"><CheckInButton schedule={checkIn} label="Review this week" onClick={openCheckIn}/><p className="energy-check-in-label">Check-in ready</p></div>
            :<EnergyRing total={total} target={targets.calories} energyUnit={energyUnit} intro={intro}/>}
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
              <progress aria-label={`${key} logged`} value={targets[key]==null?0:sum} max={targets[key]==null?1:Math.max(targets[key],1)}/>
            </div>;
          })}
        </article>
      </section>
      {showGoogleHealthSteps && <MotionPanel motionKey="dashboard-steps" axis="reveal" animateOnMount={intro} className="dashboard-steps-reveal"><GoogleHealthStepsCard status={ghState.status} freshness={ghState.freshness} lastSyncedAt={ghState.lastSyncedAt} days={ghState.days} todayDate={date} warningMessage={ghState.warningMessage} onOpenSettings={onSettings}><StepCalorieCalculator store={store} variant="inline"/></GoogleHealthStepsCard></MotionPanel>}
      {goalProgress&&<section className="panel dashboard-goal-panel" aria-labelledby="dashboard-goal-title">
        <GoalSummary progress={goalProgress} units={unitsFor(state.settings)} weightGoalMetric={state.settings?.weightGoalMetric??'scale'}/>
      </section>}
      <section className="panel dashboard-trend-panel"><p className="eyebrow">TREND WEIGHT</p><h2>{displayWeight(latestWeight?.kg,unitsFor(state.settings).weight,1)} <span className="unit">{weightLabel(unitsFor(state.settings).weight)}</span></h2><small>{latestWeight?`As of ${latestWeight.date}`:"No weigh-in yet"}</small></section>
      <TrainingSummaryCard syncedAt={state.trainingSyncedAt} summaries={state.trainingSummaries} settings={state.settings} timeZone={state.profile?.timeZone} workoutConnected={state.workoutConnected} warning={state.workoutWarning} loading={store.trainingLoading} resolved={store.trainingResolved} error={store.trainingError} onOpenSettings={onSettings} onRetry={()=>void loadTrainingSummaries?.(true)}/>
      </div>
    </>}
    <CheckInDialog open={checkInOpen} store={store} restoreFocus={checkInRestore} onClose={()=>setCheckInOpen(false)}/>
  </>;
}

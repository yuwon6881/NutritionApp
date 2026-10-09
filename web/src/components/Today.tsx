import {useEffect,useMemo,useState} from 'react';
import type {NutritionStore} from '../useNutritionStore';
import type {CoachResult} from '../types';
import {number,today} from '../lib/format';
import {cleanTrend} from '../lib/weightSignal';
import {liveGoalProgress,mergeGoalProgress} from '../lib/goalProgress';
import {planForDate,targetsForDate} from '../lib/dailyTargets';
import {GoalReachedBanner} from './GoalReachedBanner';
import {GoalSummary} from './GoalSummary';
import {CheckInButton} from './CheckInButton';
import {checkInSchedule} from '../lib/checkIn';
import {CheckInDialog} from './CheckInDialog';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {shouldShowDashboardSteps,useGoogleHealth} from '../lib/googleHealth';
import {GoogleHealthStepsCard} from './GoogleHealthStepsCard';
import {StepCalorieCalculator} from './StepCalorieCalculator';
import {TrainingSummaryCard} from './TrainingSummaryCard';
import {EnergyOverview} from './EnergyOverview';
import {MotionPanel} from './ui/Motion';
import {HabitCalendars} from './habits/HabitCalendars';
import {DashboardSkeleton} from './ui/Skeleton';
import {useOnlineStatus} from './ui/useOnlineStatus';
import {WeekNutritionCard} from './dashboard/WeekNutritionCard';
import {WeightTrendCard} from './dashboard/WeightTrendCard';

// The landing cascade plays once per launch; returning to the Dashboard uses the page transition only.
let dashboardIntroPlayed=false;

export function Today({store,onCoach,onProgress,onSettings}:{store:NutritionStore;onCoach:()=>void;onProgress:()=>void;onSettings?:()=>void}){
  const state=store.state!;
  const date=today(state.profile?.timeZone);
  // The same cleaned trend the coach uses: marked temporary days and statistical outliers stay out.
  const weightTrend=useMemo(()=>cleanTrend([...(state.weightTrendSeed??[]),...state.weights.filter(w=>!w.deleted)],date),[state.weightTrendSeed,state.weights,date]);
  const energyUnit=unitsFor(state.settings).energy;
  const [checkInOpen,setCheckInOpen]=useState(false);
  const [intro]=useState(()=>!dashboardIntroPlayed);
  useEffect(()=>{dashboardIntroPlayed=true;},[]);
  const [checkInRestore,setCheckInRestore]=useState<HTMLElement|null>(null);
  const entries=state.entries.filter(e=>!e.deleted&&e.date===date);
  const savedDay=state.days.find(d=>d.date===date&&!d.deleted);
  const total=savedDay?.archived?(savedDay.calories??0):entries.reduce((s,e)=>s+e.calories,0);
  const accepted=state.plans.find(p=>!p.deleted);
  const latestPlan:CoachResult|undefined=accepted?JSON.parse(accepted.resultJson):undefined;
  const targets=targetsForDate(planForDate(state,date),date);
  const phaseDecision=state.phaseDecisions?.find(decision=>decision.profileRevision===state.profileRevision&&!decision.deleted);
  const liveProgress=useMemo(()=>liveGoalProgress(state.profile,[...(state.weightTrendSeed??[]),...state.weights.filter(w=>!w.deleted)],date,phaseDecision,state.settings?.weightGoalMetric??'scale'),[state.profile,state.weightTrendSeed,state.weights,date,phaseDecision,state.settings?.weightGoalMetric]);
  const goalProgress=mergeGoalProgress(latestPlan?.goalProgress,liveProgress,phaseDecision);
  const loaded=date>=state.start&&date<=state.end;
  const online=useOnlineStatus();
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
    {!loaded?online
      // Online, today is simply still arriving (a cold start or a waking server): show its shape, not an offline notice.
      ?<DashboardSkeleton heading={false} label="Loading today…"/>
      :<section className="panel">
        <h2>Not stored on this device</h2>
        <p>Connect to load this date.</p>
      </section>:<>
      <div className={intro?'dashboard-cards dashboard-intro':'dashboard-cards'}>
      <section className="dashboard-section dashboard-section-today" aria-labelledby="dashboard-today-title">
      <h2 id="dashboard-today-title" className="dashboard-section-title">Today</h2>
      <div className="daily-grid">
        {checkInReady&&checkIn
          ?<article className="panel energy-panel">
            <div>
              <p className="eyebrow">ENERGY</p>
              <h2>{displayEnergy(total,energyUnit)} <span className="unit">{energyLabel(energyUnit)} logged</span></h2>
              <p>Review your check-in to see today's target</p>
            </div>
            <div className="energy-check-in"><CheckInButton schedule={checkIn} label="Review this week" onClick={openCheckIn}/><p className="energy-check-in-label">Check-in ready</p></div>
          </article>
          :<article className="panel energy-panel energy-panel-overview">
            <p className="eyebrow">ENERGY</p>
            <EnergyOverview total={total} target={targets.calories} energyUnit={energyUnit} intro={intro}/>
          </article>}
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
      </div>
      {showGoogleHealthSteps && <MotionPanel motionKey="dashboard-steps" axis="reveal" animateOnMount={intro} className="dashboard-steps-reveal"><GoogleHealthStepsCard status={ghState.status} freshness={ghState.freshness} lastSyncedAt={ghState.lastSyncedAt} days={ghState.days} todayDate={date} warningMessage={ghState.warningMessage} onOpenSettings={onSettings}><StepCalorieCalculator store={store} variant="inline"/></GoogleHealthStepsCard></MotionPanel>}
      </section>
      <section className="dashboard-section dashboard-section-habits" aria-labelledby="dashboard-habits-title">
        <h2 id="dashboard-habits-title" className="dashboard-section-title">Habits</h2>
        <HabitCalendars state={state} current={date}/>
      </section>
      <section className="dashboard-section dashboard-section-insights" aria-labelledby="dashboard-insights-title">
      <h2 id="dashboard-insights-title" className="dashboard-section-title">Insights &amp; analytics</h2>
      <WeekNutritionCard state={state} current={date} energyUnit={energyUnit} checkInDue={checkInReady}/>
      <div className="dashboard-insight-pair">
        {goalProgress&&<section className="panel dashboard-goal-panel" aria-labelledby="dashboard-goal-title">
          <GoalSummary progress={goalProgress} units={unitsFor(state.settings)} weightGoalMetric={state.settings?.weightGoalMetric??'scale'}/>
        </section>}
        <WeightTrendCard points={weightTrend} current={date} unit={unitsFor(state.settings).weight} onOpen={onProgress}/>
      </div>
      <TrainingSummaryCard syncedAt={state.trainingSyncedAt} summaries={state.trainingSummaries} settings={state.settings} timeZone={state.profile?.timeZone} workoutConnected={state.workoutConnected} warning={state.workoutWarning} loading={store.trainingLoading} resolved={store.trainingResolved} error={store.trainingError} onOpenSettings={onSettings} onRetry={()=>void loadTrainingSummaries?.(true)}/>
      </section>
      </div>
    </>}
    <CheckInDialog open={checkInOpen} store={store} restoreFocus={checkInRestore} onClose={()=>setCheckInOpen(false)}/>
  </>;
}

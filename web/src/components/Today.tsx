import {lazy,Suspense,useEffect,useMemo,useState} from 'react';
import type {NutritionStore} from '../useNutritionStore';
import type {CoachResult} from '../types';
import {today} from '../lib/format';
import {liveGoalProgress,mergeGoalProgress} from '../lib/goalProgress';
import {planForDate,targetsForDate} from '../lib/dailyTargets';
import {GoalReachedBanner} from './GoalReachedBanner';
import {goalNeedsDecision} from '../lib/goalDecision';
import {GoalReachedOrb} from './GoalReachedOrb';
const GoalReachedDialog=lazy(()=>import('./GoalReachedDialog').then(module=>({default:module.GoalReachedDialog})));
import {GoalSummary} from './GoalSummary';
import {CheckInButton} from './CheckInButton';
import {checkInSchedule} from '../lib/checkIn';
import {CheckInDialog} from './CheckInDialog';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {shouldShowDashboardSteps,useGoogleHealth} from '../lib/googleHealth';
import {DashboardSteps} from './DashboardSteps';
import {EnergyOverview} from './EnergyOverview';
import {HabitCalendars} from './habits/HabitCalendars';
import {DashboardSkeleton,ChartCardSkeleton} from './ui/Skeleton';
import {useOnlineStatus} from './ui/useOnlineStatus';
import {TodayMacros} from './dashboard/TodayMacros';
import {WeekNutritionCard} from './dashboard/WeekNutritionCard';
import type {ProgressPeriod} from '../types';
import {useWeightProgress} from './dashboard/useWeightProgress';
import {BodyHubSkeleton} from './body/BodyHubSkeleton';

// The chart cards are the heaviest part of the Dashboard and sit below the fold, so their code loads after the first paint.
const WeightProgressCard=lazy(()=>import('./dashboard/WeightProgressCard').then(module=>({default:module.WeightProgressCard})));
const WeightHistoryCard=lazy(()=>import('./dashboard/WeightHistoryCard').then(module=>({default:module.WeightHistoryCard})));
const EnergyProgressCard=lazy(()=>import('./dashboard/EnergyProgressCard').then(module=>({default:module.EnergyProgressCard})));
const ActivityCard=lazy(()=>import('./dashboard/ActivityCard').then(module=>({default:module.ActivityCard})));
const PhysiquePhotos=lazy(()=>import('./PhysiquePhotos').then(module=>({default:module.PhysiquePhotos})));

// The landing cascade plays once per launch; returning to the Dashboard uses the page transition only.
let dashboardIntroPlayed=false;

export function Today({store,onCoach,onSettings}:{store:NutritionStore;onCoach:()=>void;onSettings?:()=>void}){
  const state=store.state!;
  const date=today(state.profile?.timeZone);
  const energyUnit=unitsFor(state.settings).energy;
  // The weight card and its weigh-in list, at the foot of the page, read the same period.
  const [weightPeriod,setWeightPeriod]=useState<ProgressPeriod>(()=>(state.settings?.weightPeriod as ProgressPeriod)??'month');
  useEffect(()=>{
    const saved=state.settings?.weightPeriod as ProgressPeriod|undefined;
    if(saved&&saved!==weightPeriod)setWeightPeriod(saved);
  },[state.settings?.weightPeriod]);
  const handleWeightPeriod=(next:ProgressPeriod)=>{
    setWeightPeriod(next);
    if(next!==state.settings?.weightPeriod){
      void store.mutate({
        kind:'settings',
        recordId:state.id,
        expectedRevision:state.settings?.revision??0,
        data:{weightPeriod:next},
        delete:false
      });
    }
  };
  const weightProgress=useWeightProgress(store,weightPeriod);
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
  const checkIn=state.profile&&accepted?checkInSchedule(state,date):undefined;
  const checkInReady=Boolean(checkIn?.due)&&loaded;
  const openCheckIn=(trigger:HTMLElement)=>{setCheckInRestore(trigger);setCheckInOpen(true);};
  // A reached goal waits for the user's decision; its ring replaces the calorie ring until then.
  const goalDecision=loaded&&goalNeedsDecision(goalProgress,state.settings?.weightGoalMetric??'scale');
  const [goalOpen,setGoalOpen]=useState(false);
  const [goalRestore,setGoalRestore]=useState<HTMLElement|null>(null);
  const {state: ghState,loading: ghLoading}=useGoogleHealth();
  // Do not show an integration card while its first status request is unresolved.
  // Once a connection is known, keep the card visible during background refresh so
  // a temporary loading state does not make the dashboard jump.
  const showGoogleHealthSteps = shouldShowDashboardSteps(ghState,ghLoading);
  return <>
    <header className="page-heading"><h1 data-page-heading tabIndex={-1}>Dashboard</h1></header>
    <GoalReachedBanner progress={goalProgress} store={store} onChooseGoal={onCoach} action="Open coach"/>
    {!loaded?online
      // Online, today is simply still arriving (a cold start or a waking server): show its shape, not an offline notice.
      ?<DashboardSkeleton heading={false} label="Loading today…"/>
      :<section className="panel">
        <h2>Not stored on this device</h2>
        <p>Connect to load this date.</p>
      </section>:<>
      <div className={intro?'dashboard-cards dashboard-intro':'dashboard-cards'}>
      <section className="dashboard-section dashboard-section-today" aria-labelledby="dashboard-today-title">
      <div className="dashboard-section-head">
        <h2 id="dashboard-today-title" className="dashboard-section-title">Today</h2>
        {showGoogleHealthSteps&&<DashboardSteps store={store} health={ghState} todayDate={date} onOpenSettings={onSettings}/>}
      </div>
      <div className="daily-grid">
        {goalDecision
          ?<article className="panel energy-panel">
            <div>
              <p className="eyebrow">Energy</p>
              <h2>{displayEnergy(total,energyUnit)} <span className="unit">{energyLabel(energyUnit)} logged</span></h2>
              <p>Your goal is reached. Open it to choose what comes next.</p>
            </div>
            <div className="energy-check-in"><GoalReachedOrb onClick={trigger=>{setGoalRestore(trigger);setGoalOpen(true);}}/><p className="energy-check-in-label">Goal complete</p></div>
          </article>
          :checkInReady&&checkIn
          ?<article className="panel energy-panel">
            <div>
              <p className="eyebrow">Energy</p>
              <h2>{displayEnergy(total,energyUnit)} <span className="unit">{energyLabel(energyUnit)} logged</span></h2>
              <p>Review your check-in to see today's target</p>
            </div>
            <div className="energy-check-in"><CheckInButton schedule={checkIn} label="Review this week" onClick={openCheckIn}/><p className="energy-check-in-label">Check-in ready</p></div>
          </article>
          :<article className="panel energy-panel energy-panel-overview">
            <p className="eyebrow">Energy</p>
            <EnergyOverview total={total} target={targets.calories} energyUnit={energyUnit} intro={intro}/>
          </article>}
        <TodayMacros entries={entries} savedDay={savedDay} targets={targets}/>
      </div>
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
      </div>
      <Suspense fallback={<ChartCardSkeleton/>}><WeightProgressCard store={store} period={weightPeriod} onPeriod={handleWeightPeriod} progress={weightProgress}/></Suspense>
      <Suspense fallback={<ChartCardSkeleton/>}><EnergyProgressCard store={store}/></Suspense>
      </section>
      <section className="dashboard-section dashboard-section-body" aria-labelledby="dashboard-body-title">
        <h2 id="dashboard-body-title" className="dashboard-section-title sr-only">Body</h2>
        <Suspense fallback={<BodyHubSkeleton/>}><PhysiquePhotos store={store}/></Suspense>
      </section>
      <section className="dashboard-section dashboard-section-activity">
        <Suspense fallback={<ChartCardSkeleton/>}><ActivityCard store={store} onSettings={onSettings}/></Suspense>
        <Suspense fallback={<ChartCardSkeleton/>}><WeightHistoryCard store={store} progress={weightProgress}/></Suspense>
      </section>
      </div>
    </>}
    {goalOpen&&goalDecision&&<Suspense fallback={null}><GoalReachedDialog open progress={goalProgress} store={store} onClose={()=>{setGoalOpen(false);goalRestore?.focus();}} onChooseGoal={onCoach}/></Suspense>}
    <CheckInDialog open={checkInOpen} store={store} restoreFocus={checkInRestore} onClose={()=>setCheckInOpen(false)}/>
  </>;
}

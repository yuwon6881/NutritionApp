import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {NutritionStore} from '../useNutritionStore';
import type {ProgressPeriod,ProgressSummary,Weight} from '../types';
import {readoutDate,today} from '../lib/format';
import {Plus} from 'lucide-react';
import {Button} from './ui/Button';
import {BodyHubSkeleton} from './body/BodyHubSkeleton';
import {CoachingProgress} from './CoachingProgress';
import {EnergyBalance} from './EnergyBalance';
import {WeightEntryDialog} from './WeightEntryDialog';
import {showUndo} from './ui/UndoToast';
import {UNDO_WINDOW_MS} from '../lib/heldMutations';
import {SegmentedControl} from './ui/SegmentedControl';
import {MotionPanel,useReducedMotion} from './ui/Motion';
import {SelectField} from './ui/Field';
import {displayWeight,unitsFor,weightLabel} from '../lib/units';
import {projectProgressWeightSummary,progressPeriodOptions,projectedProgressRange} from '../lib/progress';
import {useGoogleHealth} from '../lib/googleHealth';
import {GoogleHealthProgressChart} from './GoogleHealthProgressChart';
import {TrainingSummaryCard} from './TrainingSummaryCard';
import {CardFeedback} from './ui/CardFeedback';
import {StepCalorieCalculator} from './StepCalorieCalculator';
import {progressDataKey} from '../lib/progressFreshness';
import {useDelayedPending} from './ui/useDelayedPending';
import {WeightSummary} from './WeightSummary';
import {WeightDeleteDialog} from './WeightDeleteDialog';

type Tab='weight'|'energy'|'body'|'activity';
/** A part of the Weight tab another page can open Progress at. */
export type ProgressFocus='chart'|'history';
const focusTargets:Record<ProgressFocus,string>={chart:'progress-weight-chart',history:'progress-weight-history'};
const PhysiquePhotos=lazy(()=>import('./PhysiquePhotos').then(module=>({default:module.PhysiquePhotos})));
const progressKinds=new Set(['entry','weight','day','profile','settings']);

function useProgressSummary(store:NutritionStore,period:ProgressPeriod,enabled:boolean){
  const [error,setError]=useState('');
  const cached=store.local?.progress?.[period];
  const [retained,setRetained]=useState<ProgressSummary|undefined>(cached);
  useEffect(()=>{
    if(cached)setRetained(cached);
  },[cached]);
  const activeSummary=cached??retained;
  const isFetching=!cached&&enabled;
  const [loading,setLoading]=useState(isFetching);
  const cachedRef=useRef(cached);
  cachedRef.current=cached;
  const refreshProgress=store.refreshProgress;
  const load=useCallback(async()=>{
    if(!enabled)return;
    if(!cachedRef.current)setLoading(true);
    setError('');
    try{await refreshProgress(period);}catch(ex){setError((ex as Error).message);}
    finally{setLoading(false);}
  },[enabled,period,refreshProgress]);
  const revision=progressDataKey(store.local?.state);
  useEffect(()=>{void load();},[load,revision,store.calendarDate]);
  return {
    summary:activeSummary,
    displayedPeriod:cached?period:(retained?.period??period),
    error,
    loading:loading||isFetching,
    retry:load
  };
}

export function Progress({store,focus,onFocused,onSettings}:{store:NutritionStore;focus?:ProgressFocus|null;onFocused?:()=>void;onSettings?:()=>void}){
  const [tab,setTab]=useState<Tab>('weight');
  const reducedMotion=useReducedMotion();
  const [weightPeriod,setWeightPeriod]=useState<ProgressPeriod>('month');
  const [energyPeriod,setEnergyPeriod]=useState<ProgressPeriod>('month');
  const [weightOpen,setWeightOpen]=useState(false);
  const [weightEdit,setWeightEdit]=useState<Weight>();
  const [weightDelete,setWeightDelete]=useState<{weight:Weight;trigger:HTMLElement}>();
  const [weightReturnFocus,setWeightReturnFocus]=useState<HTMLElement|null>(null);
  const weight=useProgressSummary(store,weightPeriod,tab==='weight');
  const energy=useProgressSummary(store,energyPeriod,tab==='energy');
  const weightPending=useDelayedPending(weight.loading&&Boolean(weight.summary));
  const energyPending=useDelayedPending(energy.loading&&Boolean(energy.summary));
  const {state:ghState,loading:ghLoading}=useGoogleHealth(tab==='activity');
  const state=store.state!;
  // Depend on the stable loader, not the store object: every commit returns a new store, so a
  // store dependency re-fetched after each response in an endless loop.
  const loadTrainingSummaries=store.loadTrainingSummaries;
  useEffect(()=>{if(tab==='activity')void loadTrainingSummaries?.();},[loadTrainingSummaries,tab]);
  const units=unitsFor(state.settings);
  // The weigh-in list comes from the server summary; queued deletions must disappear at once so Undo reads true.
  const pendingWeightDeletes=new Set((store.local?.queue??[]).filter(op=>op.kind==='weight'&&op.delete).map(op=>op.recordId));
  const deleteWeight=async(weight:Weight)=>{
    const id=await store.mutate({kind:'weight',recordId:weight.id,expectedRevision:weight.revision,data:weight,delete:true},{holdMs:UNDO_WINDOW_MS});
    showUndo(`Deleted weigh-in · ${displayWeight(weight.kg,units.weight,2)} ${weightLabel(units.weight)} · ${readoutDate(weight.date)}`,()=>store.undo([id]));
  };
  const tabs=[['weight','Weight'],['energy','Energy'],['body','Body'],['activity','Activity']] as const;
  const tabDirection:1|-1=tab==='body'||tab==='activity'?-1:1;
  const pending=store.local?.queue.some(item=>progressKinds.has(item.kind))??false;
  const addWeight=(trigger?:HTMLElement|null)=>{setWeightEdit(undefined);setWeightReturnFocus(trigger??null);setWeightOpen(true);};
  const editWeight=(weight:Weight,trigger:HTMLElement)=>{setWeightEdit(weight);setWeightReturnFocus(trigger);setWeightOpen(true);};
  const localToday = today(state.profile?.timeZone);
  const displayedWeightPeriod = weight.displayedPeriod;
  const range = useMemo(() => projectedProgressRange(displayedWeightPeriod, localToday, weight.summary, state.weights, store.local?.queue ?? []),
    [displayedWeightPeriod, localToday, weight.summary, state.weights, store.local?.queue]);
  const projectedWeightSummary = useMemo(() => {
    return projectProgressWeightSummary(
      range,
      weight.summary?.weight,
      store.local?.queue ?? [],
      store.state?.weights
    );
  }, [range, weight.summary?.weight, store.local?.queue, store.state?.weights]);

  const activeWeightProgressSummary: ProgressSummary | undefined = useMemo(() => {
    if (weight.summary && projectedWeightSummary) {
      return {
        ...weight.summary,
        start: range.start,
        end: range.end,
        weight: projectedWeightSummary,
        awaitingSynchronization: projectedWeightSummary.statistics.trendPending || weight.summary.awaitingSynchronization
      };
    }
    if (!weight.summary && projectedWeightSummary) {
      return {
        period: displayedWeightPeriod,
        start: range.start,
        end: range.end,
        revision: state.revision,
        grouping: { weight: 'daily', energy: 'daily' },
        weight: projectedWeightSummary,
        energy: {
          statistics: {
            days: 0,
            loggedDays: 0,
            completeDays: 0,
            totalIntake: null,
            averageIntake: null,
            averageMaintenance: null,
            totalBalance: null,
            surplusDays: 0,
            deficitDays: 0
          },
          series: []
        },
        awaitingSynchronization: true
      };
    }
    return weight.summary;
  }, [weight.summary, projectedWeightSummary, displayedWeightPeriod, range.start, range.end, state.revision]);

  // A requested section scrolls into view once its weight summary has rendered, then the request is spent.
  // A refresh can still reflow the sections above, so the scroll waits for the summary to settle.
  const weightSettled=Boolean(activeWeightProgressSummary)&&!weight.loading;
  useEffect(()=>{
    if(!focus||!weightSettled)return;
    if(tab!=='weight'){setTab('weight');return;}
    const frame=requestAnimationFrame(()=>{
      document.getElementById(focusTargets[focus])?.scrollIntoView({block:'start',behavior:reducedMotion?'instant':'smooth'});
      onFocused?.();
    });
    return()=>cancelAnimationFrame(frame);
  },[focus,weightSettled,tab,reducedMotion,onFocused]);

  const summary = tab === 'weight' ? activeWeightProgressSummary : energy.summary;
  const error = tab === 'weight' ? weight.error : energy.error;
  const loading = tab === 'weight' ? weight.loading : energy.loading;
  const retry = tab === 'weight' ? weight.retry : energy.retry;

  return <>
    <header className="page-heading"><div><h1 data-page-heading tabIndex={-1}>Progress</h1></div></header>
    <SegmentedControl<Tab> id="progress-tabs" layout="equal" className="section-segments" label="Progress sections" value={tab} onChange={setTab} options={tabs.map(([value,label])=>({value,label:<span className="progress-tab-label">{label}</span>}))}/>
    <MotionPanel motionKey={tab} direction={tabDirection}>
    <div role="tabpanel" aria-label={`${tabs.find(([value])=>value===tab)?.[1]??tab} progress`}>
    {tab==='weight'&&<div className="progress-tab-content" data-pending={weightPending||undefined}>
      {/* The weigh-in action belongs to this tab, so switching tabs never moves the tab bar. */}
      <div className="history-toolbar">
        <div className="history-filter"><SelectField label="Weight history period" value={weightPeriod} onChange={value=>setWeightPeriod(value as ProgressPeriod)}>
          {progressPeriodOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
        </SelectField></div>
        <Button variant="primary" onClick={event=>addWeight(event.currentTarget)}><Plus size={18} aria-hidden="true"/>Add weigh-in</Button>
      </div>
      {error&&<CardFeedback
        title={summary?'Progress summary needs attention':'Progress summary unavailable'}
        message={`${summary?'Showing saved data.':'Not available offline.'} ${error}`}
        action={{label:'Retry',onClick:()=>void retry(),disabled:loading}}
      />}
      {summary?.weight.historyUnavailable&&!error&&<CardFeedback
        tone="info"
        title="History unavailable offline"
        message="Showing weigh-ins saved on this device."
      />}
      {!summary&&!error&&<div className="stats-grid skeleton" aria-busy="true"><section className="panel"><p className="eyebrow">Trend weight</p><h2>— <span className="unit">{weightLabel(units.weight)}</span></h2></section><section className="panel"><p className="eyebrow">Average scale weight</p><h2>— <span className="unit">{weightLabel(units.weight)}</span></h2></section><section className="panel"><p className="eyebrow">Weigh-ins</p><h2>—</h2></section></div>}
      {summary&&<WeightSummary summary={summary} units={units} pending={pending||Boolean(summary.awaitingSynchronization)} onEdit={editWeight} onDelete={(weight,trigger)=>setWeightDelete({weight,trigger})} pendingDeletes={pendingWeightDeletes}/>}
    </div>}
    {tab==='energy'&&<div className="progress-tab-content" data-pending={energyPending||undefined}>
      <div className="history-filter"><SelectField label="Energy history period" value={energyPeriod} onChange={value=>setEnergyPeriod(value as ProgressPeriod)}>
        {progressPeriodOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
      </SelectField></div>
      <EnergyBalance store={store} period={energy.displayedPeriod} summary={energy.summary} error={energy.error}/>
      <CoachingProgress store={store}/>
    </div>}
    {tab==='body'&&<Suspense fallback={<BodyHubSkeleton/>}><PhysiquePhotos store={store}/></Suspense>}
    {tab==='activity'&&<div className="activity-progress-hub">
      <GoogleHealthProgressChart days={ghState.days} status={ghState.status} freshness={ghState.freshness} todayDate={today(state.profile?.timeZone)} loading={ghLoading} onOpenSettings={onSettings}/>
      <StepCalorieCalculator store={store} variant="panel"/>
      <TrainingSummaryCard summaries={state.trainingSummaries} settings={state.settings} timeZone={state.profile?.timeZone} workoutConnected={state.workoutConnected} warning={state.workoutWarning} loading={store.trainingLoading} resolved={store.trainingResolved} error={store.trainingError} onOpenSettings={onSettings} onRetry={()=>void loadTrainingSummaries?.(true)}/>
    </div>}
    </div>
    </MotionPanel>
    <WeightEntryDialog open={weightOpen} store={store} date={weightEdit?.date??today(store.state!.profile?.timeZone)} initial={weightEdit} restoreFocus={weightReturnFocus} onClose={()=>setWeightOpen(false)}/>
    {weightDelete&&<WeightDeleteDialog weight={weightDelete.weight} unit={units.weight} restoreFocus={weightDelete.trigger} onClose={()=>setWeightDelete(undefined)} onDelete={deleteWeight}/>}
  </>;
}

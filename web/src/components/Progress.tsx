import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {Nourish} from '../useNourish';
import type {ProgressPeriod,ProgressSummary,Weight} from '../types';
import {today} from '../lib/format';
import {Button} from './ui/Button';
import {SkeletonBlock} from './ui/Skeleton';
import {CoachingProgress} from './CoachingProgress';
import {EnergyBalance} from './EnergyBalance';
import {WeightEntryDialog} from './WeightEntryDialog';
import {showUndo} from './ui/UndoToast';
import {UNDO_WINDOW_MS} from '../lib/heldMutations';
import {SegmentedControl} from './ui/SegmentedControl';
import {MotionPanel} from './ui/Motion';
import {SelectField} from './ui/Field';
import {displayWeight,unitsFor,weightLabel} from '../lib/units';
import {projectProgressWeightSummary,progressPeriodOptions,projectedProgressRange} from '../lib/progress';
import {useGoogleHealth} from '../lib/googleHealth';
import {GoogleHealthProgressChart} from './GoogleHealthProgressChart';
import {TrainingSummaryCard} from './TrainingSummaryCard';
import {CardFeedback} from './ui/CardFeedback';
import {StepCalorieCalculator} from './StepCalorieCalculator';
import {progressDataKey} from '../lib/progressFreshness';
import {WeightSummary} from './WeightSummary';

type Tab='weight'|'energy'|'body'|'activity';
const PhysiquePhotos=lazy(()=>import('./PhysiquePhotos').then(module=>({default:module.PhysiquePhotos})));
const progressKinds=new Set(['entry','weight','day','profile','settings']);

function useProgressSummary(store:Nourish,period:ProgressPeriod,enabled:boolean){
  const [error,setError]=useState('');
  const cached=store.local?.progress?.[period];
  const [retained,setRetained]=useState<ProgressSummary|undefined>(cached);
  useEffect(()=>{
    if(cached)setRetained(cached);
  },[cached]);
  const activeSummary=cached??retained;
  const [loading,setLoading]=useState(!cached&&enabled);
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
  return {summary:activeSummary,error,loading,retry:load};
}

export function Progress({store,onSettings}:{store:Nourish;onSettings?:()=>void}){
  const [tab,setTab]=useState<Tab>('weight');
  const [weightPeriod,setWeightPeriod]=useState<ProgressPeriod>('month');
  const [energyPeriod,setEnergyPeriod]=useState<ProgressPeriod>('month');
  const [weightOpen,setWeightOpen]=useState(false);
  const [weightEdit,setWeightEdit]=useState<Weight>();
  const [weightReturnFocus,setWeightReturnFocus]=useState<HTMLElement|null>(null);
  const weight=useProgressSummary(store,weightPeriod,tab==='weight');
  const energy=useProgressSummary(store,energyPeriod,tab==='energy');
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
    showUndo(`Deleted the ${displayWeight(weight.kg,units.weight,2)} ${weightLabel(units.weight)} weigh-in from ${weight.date}`,()=>store.undo([id]));
  };
  const tabs=[['weight','Weight'],['energy','Energy'],['body','Body'],['activity','Activity']] as const;
  const tabDirection:1|-1=tab==='body'||tab==='activity'?-1:1;
  const pending=store.local?.queue.some(item=>progressKinds.has(item.kind))??false;
  const addWeight=(trigger?:HTMLElement|null)=>{setWeightEdit(undefined);setWeightReturnFocus(trigger??null);setWeightOpen(true);};
  const editWeight=(weight:Weight,trigger:HTMLElement)=>{setWeightEdit(weight);setWeightReturnFocus(trigger);setWeightOpen(true);};
  const localToday = today(state.profile?.timeZone);
  const range = useMemo(() => projectedProgressRange(weightPeriod, localToday, weight.summary, state.weights, store.local?.queue ?? []),
    [weightPeriod, localToday, weight.summary, state.weights, store.local?.queue]);
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
        period: weightPeriod,
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
  }, [weight.summary, projectedWeightSummary, weightPeriod, range.start, range.end, state.revision]);

  const summary = tab === 'weight' ? activeWeightProgressSummary : energy.summary;
  const error = tab === 'weight' ? weight.error : energy.error;
  const loading = tab === 'weight' ? weight.loading : energy.loading;
  const retry = tab === 'weight' ? weight.retry : energy.retry;

  return <>
    <header className="page-heading"><div><h1 data-page-heading tabIndex={-1}>Progress</h1></div><div className="page-heading-actions">{tab==='weight'&&<Button variant="primary" onClick={event=>addWeight(event.currentTarget)}>Add weigh-in</Button>}</div></header>
    <SegmentedControl<Tab> id="progress-tabs" className="section-segments" label="Progress sections" value={tab} onChange={setTab} options={tabs.map(([value,label])=>({value,label}))}/>
    <MotionPanel motionKey={tab} direction={tabDirection}>
    <div role="tabpanel" aria-label={`${tabs.find(([value])=>value===tab)?.[1]??tab} progress`}>
    {tab==='weight'&&<>
      <div className="history-filter"><SelectField label="Weight history period" value={weightPeriod} onChange={value=>setWeightPeriod(value as ProgressPeriod)}>
        {progressPeriodOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
      </SelectField></div>
      {error&&<CardFeedback
        title={summary?'Progress summary needs attention':'Progress summary unavailable'}
        message={`${summary?'Saved summary shown.':'This summary is not available on this device.'} ${error}`}
        action={{label:'Retry summary',onClick:()=>void retry(),disabled:loading}}
      />}
      {summary?.weight.historyUnavailable&&!error&&<CardFeedback
        tone="info"
        title="History unavailable offline"
        message="Detailed trend history is not cached for this period. Showing local retained weigh-ins; server-derived trends will refresh after synchronization."
      />}
      {!summary&&!error&&<div className="stats-grid skeleton" aria-busy="true"><section className="panel"><p className="eyebrow">TREND WEIGHT</p><h2>— <span className="unit">{weightLabel(units.weight)}</span></h2><p>Loading history…</p></section><section className="panel"><p className="eyebrow">AVERAGE SCALE WEIGHT</p><h2>— <span className="unit">{weightLabel(units.weight)}</span></h2><p>Loading history…</p></section><section className="panel"><p className="eyebrow">WEIGH-INS</p><h2>—</h2><p>Loading history…</p></section></div>}
      {summary&&<WeightSummary summary={summary} units={units} pending={pending||Boolean(summary.awaitingSynchronization)} onEdit={editWeight} onDelete={weight=>void deleteWeight(weight)} pendingDeletes={pendingWeightDeletes}/>}
    </>}
    {tab==='energy'&&<>
      <div className="history-filter"><SelectField label="Energy history period" value={energyPeriod} onChange={value=>setEnergyPeriod(value as ProgressPeriod)}>
        {progressPeriodOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
      </SelectField></div>
      <EnergyBalance store={store} period={energyPeriod} summary={energy.summary} error={energy.error}/>
      {loading&&!energy.summary&&<p className="source" role="status" aria-busy="true">Loading the selected energy period…</p>}
      <CoachingProgress store={store}/>
    </>}
    {tab==='body'&&<Suspense fallback={<section className="panel" aria-busy="true"><p className="sr-only" role="status">Opening body records…</p><SkeletonBlock width="45%" height={28}/><SkeletonBlock height={180}/></section>}><PhysiquePhotos store={store}/></Suspense>}
    {tab==='activity'&&<div className="activity-progress-hub">
      <GoogleHealthProgressChart days={ghState.days} status={ghState.status} freshness={ghState.freshness} todayDate={today(state.profile?.timeZone)} loading={ghLoading} onOpenSettings={onSettings}/>
      <StepCalorieCalculator store={store} variant="panel"/>
      <TrainingSummaryCard summaries={state.trainingSummaries} settings={state.settings} timeZone={state.profile?.timeZone} workoutConnected={state.workoutConnected} warning={state.workoutWarning} loading={store.trainingLoading} error={store.trainingError} onOpenSettings={onSettings}/>
    </div>}
    </div>
    </MotionPanel>
    <WeightEntryDialog open={weightOpen} store={store} date={weightEdit?.date??today(store.state!.profile?.timeZone)} initial={weightEdit} restoreFocus={weightReturnFocus} onClose={()=>setWeightOpen(false)}/>
  </>;
}

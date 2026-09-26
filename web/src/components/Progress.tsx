import {useCallback,useEffect,useState} from 'react';
import type {Nourish} from '../useNourish';
import type {ProgressPeriod,ProgressSummary,Weight} from '../types';
import {today} from '../lib/format';
import {Button} from './ui/Button';
import {PhysiquePhotos} from './PhysiquePhotos';
import {WeightChart} from './WeightChart';
import {CoachingProgress} from './CoachingProgress';
import {EnergyBalance} from './EnergyBalance';
import {WeightEntryDialog} from './WeightEntryDialog';
import {showUndo} from './ui/UndoToast';
import {UNDO_WINDOW_MS} from '../lib/heldMutations';
import {SegmentedControl} from './ui/SegmentedControl';
import {MotionPanel} from './ui/Motion';
import {SelectField} from './ui/Field';
import {displayEnergy,displayWeight,energyLabel,unitsFor,weightLabel} from '../lib/units';
import {progressPeriodOptions} from '../lib/progress';
import {useGoogleHealth} from '../lib/googleHealth';
import {GoogleHealthProgressChart} from './GoogleHealthProgressChart';
import {TrainingSummaryCard} from './TrainingSummaryCard';
import {CardFeedback} from './ui/CardFeedback';

type Tab='weight'|'energy'|'body'|'activity';
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
  const load=useCallback(async()=>{
    if(!enabled)return;
    if(!cached)setLoading(true);
    setError('');
    try{await store.refreshProgress(period);}catch(ex){setError((ex as Error).message);}
    finally{setLoading(false);}
  },[cached,enabled,period,store.refreshProgress]);
  const revision=store.local?.state.revision;
  const queueKey=store.local?.queue.filter(item=>progressKinds.has(item.kind)).map(item=>item.id+item.error).join('|')??'';
  useEffect(()=>{void load();},[load,revision,queueKey,store.calendarDate]);
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
  const {state:ghState,loading:ghLoading}=useGoogleHealth();
  const state=store.state!;
  // Depend on the stable loader, not the store object: every commit returns a new store, so a
  // store dependency re-fetched after each response in an endless loop.
  const loadTrainingSummaries=store.loadTrainingSummaries;
  useEffect(()=>{void loadTrainingSummaries?.();},[loadTrainingSummaries]);
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
  const summary=tab==='weight'?weight.summary:energy.summary;
  const error=tab==='weight'?weight.error:energy.error;
  const loading=tab==='weight'?weight.loading:energy.loading;
  const retry=tab==='weight'?weight.retry:energy.retry;

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
      {!summary&&!error&&<div className="stats-grid skeleton" aria-busy="true"><section className="panel"><p className="eyebrow">TREND WEIGHT</p><h2>— <span className="unit">{weightLabel(units.weight)}</span></h2><p>Loading history…</p></section><section className="panel"><p className="eyebrow">AVERAGE SCALE WEIGHT</p><h2>— <span className="unit">{weightLabel(units.weight)}</span></h2><p>Loading history…</p></section><section className="panel"><p className="eyebrow">WEIGH-INS</p><h2>—</h2><p>Loading history…</p></section></div>}
      {summary&&<WeightSummary summary={summary} units={units} pending={pending} onEdit={editWeight} onDelete={weight=>void deleteWeight(weight)} pendingDeletes={pendingWeightDeletes}/>}
    </>}
    {tab==='energy'&&<>
      <EnergyBalance store={store} period={energyPeriod} summary={energy.summary} error={energy.error} onPeriodChange={setEnergyPeriod}/>
      {loading&&!energy.summary&&<p className="source" role="status" aria-busy="true">Loading the selected energy period…</p>}
      <CoachingProgress store={store}/>
    </>}
    {tab==='body'&&<PhysiquePhotos store={store}/>}
    {tab==='activity'&&<div className="activity-progress-hub">
      <GoogleHealthProgressChart days={ghState.days} status={ghState.status} freshness={ghState.freshness} todayDate={today(state.profile?.timeZone)} loading={ghLoading} onOpenSettings={onSettings}/>
      <TrainingSummaryCard summaries={state.trainingSummaries} settings={state.settings} timeZone={state.profile?.timeZone} workoutConnected={state.workoutConnected} warning={state.workoutWarning} onOpenSettings={onSettings}/>
    </div>}
    </div>
    </MotionPanel>
    <WeightEntryDialog open={weightOpen} store={store} date={weightEdit?.date??today(store.state!.profile?.timeZone)} initial={weightEdit} restoreFocus={weightReturnFocus} onClose={()=>setWeightOpen(false)}/>
  </>;
}

function WeightSummary({summary,units,pending,onEdit,onDelete,pendingDeletes}:{summary:ProgressSummary;units:ReturnType<typeof unitsFor>;pending:boolean;onEdit:(weight:Weight,trigger:HTMLElement)=>void;onDelete:(weight:Weight)=>void;pendingDeletes:ReadonlySet<string>}){
  const stats=summary.weight.statistics;
  const editable=summary.weight.editableWeighIns.filter(weight=>!pendingDeletes.has(weight.id));
  return <>
    {pending&&<p className="notice" role="status">Recent progress edits are retained locally and this summary will refresh after synchronization.</p>}
    <div className="stats-grid">
      <section className="panel"><p className="eyebrow">TREND WEIGHT</p><h2>{displayWeight(stats.latestTrendKg,units.weight,1)} <span className="unit">{weightLabel(units.weight)}</span></h2><p><span className="nowrap">{summary.start}</span> to <span className="nowrap">{summary.end}</span></p></section>
      <section className="panel"><p className="eyebrow">AVERAGE SCALE WEIGHT</p><h2>{displayWeight(stats.averageKg,units.weight,1)} <span className="unit">{weightLabel(units.weight)}</span></h2><p>{stats.count} weigh-ins</p></section>
      <section className="panel"><p className="eyebrow">CHANGE IN TREND</p><h2>{stats.trendChangeKg==null?'—':`${stats.trendChangeKg>0?'+':''}${displayWeight(stats.trendChangeKg,units.weight,1)}`} <span className="unit">{weightLabel(units.weight)}</span></h2><p>From first to latest point</p></section>
    </div>
    <WeightChart series={summary.weight.series} weightUnit={units.weight}/>
    <section className="panel weight-history-panel">
      <div className="section-heading"><div><h2>Latest weigh-ins</h2><p>Only recent retained weigh-ins can be edited. Older points remain in the chart.</p></div></div>
      {editable.length?<div className="weight-history">{editable.map(weight=><div className="history-row" key={weight.id}><span>{weight.date}</span><strong>{displayWeight(weight.kg,units.weight,2)} {weightLabel(units.weight)}</strong><Button variant="tertiary" size="md" onClick={event=>onEdit(weight,event.currentTarget)}>Edit</Button><Button variant="tertiary" size="md" onClick={()=>onDelete(weight)}>Delete</Button></div>)}</div>:<p className="empty">No weigh-ins in this period.</p>}
    </section>
  </>;
}

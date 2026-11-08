import type {ReactNode} from 'react';
import type {NutritionStore} from '../../useNutritionStore';
import type {ProgressPeriod,ProgressSummary} from '../../types';
import {displayWeight,unitsFor,weightLabel} from '../../lib/units';
import {progressPeriodOptions} from '../../lib/progress';
import {CardFeedback} from '../ui/CardFeedback';
import {HistoryNotice} from '../ui/HistoryNotice';
import {SelectField} from '../ui/Field';
import {SwipeCarousel,type CarouselSlide} from '../ui/SwipeCarousel';
import {useDelayedPending} from '../ui/useDelayedPending';
import {WeightChart,type WeightChartView} from '../WeightChart';
import type {WeightProgress} from './useWeightProgress';

type Units=ReturnType<typeof unitsFor>;

function Stat({label,value,note}:{label:string;value:ReactNode;note?:string}){
  return <div><dt>{label}</dt><dd>{value}</dd>{note&&<small>{note}</small>}</div>;
}

function signedWeight(kg:number|null|undefined,units:Units){
  if(kg==null)return '—';
  return `${kg>0?'+':kg<0?'−':''}${displayWeight(Math.abs(kg),units.weight,1)}`;
}

/** The figures that belong with each way of reading the weight chart. */
function WeightStats({view,summary,units}:{view:WeightChartView;summary:ProgressSummary;units:Units}){
  const stats=summary.weight.statistics;
  const pending=Boolean(stats.trendPending);
  const unit=<span className="unit">{weightLabel(units.weight)}</span>;
  const trend=<Stat label="Trend weight" value={<>{pending?'—':displayWeight(stats.latestTrendKg,units.weight,1)} {unit}</>} note={pending?'Pending sync':undefined}/>;
  const average=<Stat label="Average scale weight" value={<>{displayWeight(stats.averageKg,units.weight,1)} {unit}</>} note={`${stats.count} ${stats.count===1?'weigh-in':'weigh-ins'}`}/>;
  const change=<Stat label="Change in trend" value={<>{pending?'—':signedWeight(stats.trendChangeKg,units)} {unit}</>} note={pending?'Pending sync':undefined}/>;
  const lowest=<Stat label="Lowest" value={<>{displayWeight(stats.minimumKg,units.weight,1)} {unit}</>}/>;
  const highest=<Stat label="Highest" value={<>{displayWeight(stats.maximumKg,units.weight,1)} {unit}</>}/>;
  return <dl className="energy-stats">{view==='scale'?<>{average}{lowest}{highest}</>:view==='trend'?<>{trend}{change}</>:<>{trend}{average}{change}</>}</dl>;
}

/**
 * Weight over a chosen period: swipe between the trend, the scale readings, and both together,
 * then the weigh-ins behind them. Adding, editing, and deleting a weigh-in stay on this card.
 */
export function WeightProgressCard({store,period,onPeriod,progress,view:controlledView,onView:onControlledView}:{store:NutritionStore;period:ProgressPeriod;onPeriod:(period:ProgressPeriod)=>void;progress:WeightProgress;view?:WeightChartView;onView?:(view:WeightChartView)=>void}){
  const {summary,error,loading,retry}=progress;
  const pending=useDelayedPending(loading&&Boolean(summary));
  const state=store.state!;
  const units=unitsFor(state.settings);
  const savedView=state.settings?.weightChartView??'trend';
  const activeView=controlledView??savedView;

  const handleViewChange=(newView:string)=>{
    onControlledView?.(newView as WeightChartView);
    if(!controlledView&&newView!==savedView){
      void store.mutate({
        kind:'settings',
        recordId:state.id,
        expectedRevision:state.settings?.revision??0,
        data:{weightChartView:newView as WeightChartView},
        delete:false
      });
    }
  };

  const chart=(view:WeightChartView)=>summary
    ?<><WeightStats view={view} summary={summary} units={units}/>
      <WeightChart view={view} series={summary.weight.series} weightUnit={units.weight} periodStart={summary.start} periodEnd={summary.end}/></>
    :<div className="empty"><h3>Loading weight…</h3></div>;
  const slides:CarouselSlide[]=[
    {id:'trend',ariaLabel:'Trend weight',content:chart('trend')},
    {id:'scale',ariaLabel:'Scale weight',content:chart('scale')},
    {id:'both',ariaLabel:'Trend and scale weight',content:chart('both')},
  ];
  return <section className="panel dashboard-wide-card weight-progress-card" aria-labelledby="dashboard-weight-title" data-pending={pending||undefined}>
    <div className="dashboard-card-head">
      <h3 id="dashboard-weight-title" className="dashboard-card-title">Weight</h3>
    </div>
    {summary&&error&&<HistoryNotice error={error} hasState={true} onRetry={()=>void retry()} retryLabel="Retry" contextKey={period} store={store}/>}
    {summary?.weight.historyUnavailable&&!error&&<HistoryNotice customMessage="Showing weigh-ins saved on this device. History unavailable offline." contextKey={period} store={store}/>}
    {!summary&&error&&<CardFeedback title="Weight summary unavailable" message={`Not available offline. ${error}`} action={{label:'Retry',onClick:()=>void retry(),disabled:loading}}/>}
    <SwipeCarousel label="Weight view" slides={slides} activeId={activeView} onChange={handleViewChange} toolbar={<SelectField className="select-compact" label="Weight history period" value={period} onChange={value=>onPeriod(value as ProgressPeriod)}>
      {progressPeriodOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </SelectField>}/>
  </section>;
}

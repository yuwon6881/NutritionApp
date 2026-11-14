import {useId,useMemo} from 'react';
import {Compass} from 'lucide-react';
import type {NutritionStore} from '../useNutritionStore';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {dateAxisOffsets,dateAxisStep,niceTicks,steppedPath} from '../lib/barChart';
import {dateSpan} from '../lib/chartLabels';
import {monthYear,readoutDate,shortDate} from '../lib/format';
import {coachingDays,knownRuns,targetGapLabel,type CoachingDay} from '../lib/coachingChart';
import {EmptyState} from './ui/EmptyState';
import {BAR_AXIS_WIDTH,BarChartFrame,BarChartNav} from './ui/BarChartFrame';
import {useBarViewport,useRevealBar} from './ui/useBarViewport';
import {useWindowTier} from './ui/useWindowTier';
import {useChartScrub} from './ui/useChartScrub';
import './coaching-chart.css';

const TOP=14;
// The same narrowest day as the maintenance view, so both views of the card scroll the same span.
const MIN_DAY_WIDTH:Record<ReturnType<typeof useWindowTier>,number>={compact:7,medium:6,expanded:5};

/**
 * The coach's guidance by day: estimated maintenance, the accepted plan's daily target as a step
 * that moves only when a new plan is accepted, and the coach's provisional goal. The readout names
 * the gap between target and maintenance, so a target below the line reads as the planned deficit.
 */
export function CoachingProgress({store,rangeStart,rangeEnd}:{store:NutritionStore;rangeStart:string;rangeEnd:string}){
  const state=store.state!;
  const energyUnit=unitsFor(state.settings).energy;
  const unit=energyLabel(energyUnit);
  const tier=useWindowTier();
  const height=tier==='expanded'?240:200;
  const base=height-30;
  const readoutId=useId();
  const days=useMemo(()=>coachingDays(state.energyEstimates??[],state.acceptedTargetIntervals??[],rangeStart,rangeEnd),[state.energyEstimates,state.acceptedTargetIntervals,rangeStart,rangeEnd]);
  const viewport=useBarViewport(days.length,MIN_DAY_WIDTH[tier]);
  const {slot,contentWidth,edges}=viewport;
  const x=(index:number)=>slot*(index+.5);
  const known=days.flatMap(day=>[day.maintenance,day.goal,day.target].filter((value):value is number=>value!=null));
  const ticks=known.length?niceTicks(Math.min(...known)-50,Math.max(...known)+50,4):[0,1];
  const low=ticks[0],high=ticks.at(-1)!;
  const y=(kcal:number)=>base-(kcal-low)/Math.max(1e-9,high-low)*(base-TOP);
  const scrub=useChartScrub(days.map((_,index)=>x(index)),{tapToSelect:true});
  const selectedIndex=days.length?Math.min(scrub.index,days.length-1):-1;
  const selected:CoachingDay|undefined=days[selectedIndex];
  useRevealBar(viewport,Math.max(0,selectedIndex));
  if(!selected)return <section className="panel coaching-progress">
    <EmptyState icon={Compass} title="No guidance yet" description="Maintenance and targets appear here once the coach has an estimate or you accept a plan."/>
  </section>;

  const series=(pick:(day:CoachingDay)=>number|null)=>knownRuns(days.map(pick))
    .map(run=>days.slice(run.from,run.to+1).map((day,offset)=>`${x(run.from+offset)},${y(pick(day)!)}`).join(' '));
  const maintenance=series(day=>day.maintenance);
  const goal=series(day=>day.goal);
  const target=steppedPath(days.map(day=>day.target),slot,y);
  const hasGoal=goal.length>0;
  const gap=targetGapLabel(selected,value=>displayEnergy(value,energyUnit),unit);
  const dateLabel=dateAxisStep(slot)>=91?monthYear:shortDate;
  const labelIndices=dateAxisOffsets(days.length-1,slot)
    .filter((offset,index,all)=>index===0||dateLabel(days[offset].date)!==dateLabel(days[all[index-1]].date));
  const visibleSpan=dateSpan(days[Math.min(edges.first,days.length-1)].date,days[Math.min(edges.last,days.length-1)].date);
  const axis=ticks.map(value=><text key={value} x={BAR_AXIS_WIDTH-8} y={y(value)+4} textAnchor="end">{displayEnergy(value,energyUnit)}</text>);
  const figure=(value:number|null)=>value==null?<span className="coaching-unknown">Unknown</span>:<>{displayEnergy(value,energyUnit)} <small>{unit}/day</small></>;
  const dots:[number|null,string][]=[[selected.target,'coaching-dot is-target'],[selected.maintenance,'coaching-dot is-maintenance']];
  return <section className="panel coaching-progress">
    <div id={readoutId} className="chart-readout chart-readout-grid" aria-live="polite">
      <strong className="chart-readout-date"><time dateTime={selected.date}>{readoutDate(selected.date)}</time></strong>
      <dl>
        <div><dt><span className="legend-line swatch-coaching-maintenance" aria-hidden="true"/>Maintenance</dt><dd>{figure(selected.maintenance)}</dd></div>
        <div><dt><span className="legend-line swatch-coaching-target" aria-hidden="true"/>Target</dt><dd>{selected.target==null?<span className="coaching-unknown">No plan</span>:figure(selected.target)}</dd></div>
        {hasGoal&&<div><dt><span className="legend-line swatch-coaching-goal" aria-hidden="true"/>Suggested</dt><dd>{figure(selected.goal)}</dd></div>}
      </dl>
      {gap&&<p className="coaching-gap">{gap}</p>}
    </div>
    <div className="chart-scrub" role="group" aria-label="Coaching guidance chart. Touch the chart or use the left and right arrow keys to read a date." aria-describedby={readoutId} {...scrub.groupProps}>
      <BarChartNav range={visibleSpan}/>
      <BarChartFrame viewport={viewport} height={height} axis={axis} plotProps={scrub.svgProps} pager="days"
        label={`Maintenance, accepted target${hasGoal?' and the coach\'s suggested intake':''} across ${days.length} days. Days without a figure stay unplotted.`}>
        {ticks.map(value=><line key={value} x1={0} y1={y(value)} x2={contentWidth} y2={y(value)} className="chart-grid"/>)}
        <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={TOP-6} y2={base} className="chart-crosshair"/>
        {target&&<path d={target} className="coaching-target-line"/>}
        {maintenance.map(points=><polyline key={points} points={points} className="coaching-maintenance-line"/>)}
        {goal.map(points=><polyline key={points} points={points} className="coaching-goal-line"/>)}
        {dots.map(([value,className])=>value==null?null:<circle key={className} cx={x(selectedIndex)} cy={y(value)} r={5} className={className}/>)}
        {labelIndices.map(index=>{
          const at=x(index);
          return <text key={index} x={at} y={height-6} textAnchor={at<26?'start':at>contentWidth-26?'end':'middle'}>{dateLabel(days[index].date)}</text>;
        })}
      </BarChartFrame>
    </div>
    <ul className="chart-legend" aria-label="Coaching guidance key">
      <li><span className="legend-line swatch-coaching-maintenance" aria-hidden="true"/>Maintenance</li>
      <li><span className="legend-line swatch-coaching-target" aria-hidden="true"/>Accepted target</li>
      {hasGoal&&<li><span className="legend-line swatch-coaching-goal" aria-hidden="true"/>Suggested by coach</li>}
    </ul>
  </section>;
}

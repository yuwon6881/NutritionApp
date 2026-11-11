import {useId,useMemo} from 'react';
import {Pause,TrendingUp} from 'lucide-react';
import type {EnergyUnit,TrajectoryPoint} from '../types';
import {displayEnergy,energyLabel} from '../lib/units';
import {dateAxisOffsets,dateAxisStep,niceTicks} from '../lib/barChart';
import {dateSpan} from '../lib/chartLabels';
import {monthYear,readableDate,readoutDate,shortDate} from '../lib/format';
import {holdLabel,holdRuns,lineRuns,maintenanceDays,type MaintenanceDay} from '../lib/maintenanceTrend';
import {BAR_AXIS_WIDTH,BarChartFrame,BarChartNav} from './ui/BarChartFrame';
import {useBarViewport,useRevealBar} from './ui/useBarViewport';
import {useWindowTier} from './ui/useWindowTier';
import './maintenance-chart.css';
import {useChartScrub} from './ui/useChartScrub';

const TOP=14;
// The same narrowest day as the weight chart, so both scroll the same span on each window size.
const MIN_DAY_WIDTH:Record<ReturnType<typeof useWindowTier>,number>={compact:7,medium:6,expanded:5};

function Status({day}:{day:MaintenanceDay}){
  if(day.kcal==null)return <span className="maintenance-status">No estimate</span>;
  return day.hold
    ?<span className="maintenance-status is-holding"><Pause size={14} aria-hidden="true"/>{holdLabel[day.hold]}</span>
    :<span className="maintenance-status is-adapting"><TrendingUp size={14} aria-hidden="true"/>Adapting</span>;
}

/** Daily estimated maintenance, with the days the estimate was held shaded and drawn dashed. */
export function MaintenanceChart({points,energyUnit,rangeStart,rangeEnd}:{points:readonly TrajectoryPoint[];energyUnit:EnergyUnit;rangeStart:string;rangeEnd:string}){
  const tier=useWindowTier();
  const height=tier==='expanded'?240:200;
  const base=height-30;
  const readoutId=useId();
  const unit=energyLabel(energyUnit);
  const days=useMemo(()=>maintenanceDays(points,rangeStart,rangeEnd),[points,rangeStart,rangeEnd]);
  const holds=useMemo(()=>holdRuns(days),[days]);
  const lines=useMemo(()=>lineRuns(days),[days]);
  const viewport=useBarViewport(days.length,MIN_DAY_WIDTH[tier]);
  const {slot,contentWidth,edges}=viewport;
  const x=(index:number)=>slot*(index+.5);
  const known=days.flatMap(day=>day.kcal==null?[]:[day.kcal]);
  // A flat estimate still gets a readable band of axis rather than a single gridline.
  const ticks=known.length?niceTicks(Math.min(...known)-50,Math.max(...known)+50,4):[0,1];
  const low=ticks[0],high=ticks.at(-1)!;
  const y=(kcal:number)=>base-(kcal-low)/Math.max(1e-9,high-low)*(base-TOP);
  const knownIndices=days.flatMap((day,index)=>day.kcal==null?[]:[index]);
  const scrub=useChartScrub(knownIndices.map(x),{tapToSelect:true});
  const selectedIndex=knownIndices[scrub.index]??-1;
  const selected=days[selectedIndex];
  useRevealBar(viewport,Math.max(0,selectedIndex));
  const dateLabel=dateAxisStep(slot)>=91?monthYear:shortDate;
  const labelIndices=days.length?dateAxisOffsets(days.length-1,slot)
    .filter((offset,index,all)=>index===0||dateLabel(days[offset].date)!==dateLabel(days[all[index-1]].date)):[];
  const visibleSpan=days.length?dateSpan(days[Math.min(edges.first,days.length-1)].date,days[Math.min(edges.last,days.length-1)].date):'';
  const path=(from:number,to:number)=>days.slice(from,to+1).map((day,offset)=>`${x(from+offset)},${y(day.kcal!)}`).join(' ');
  const axis=ticks.map(value=><text key={value} x={BAR_AXIS_WIDTH-8} y={y(value)+4} textAnchor="end">{displayEnergy(value,energyUnit)}</text>);
  const heldDays=days.filter(day=>day.hold!=null).length;
  return <section className="panel maintenance-chart-panel">
    {selected?<>
      <div id={readoutId} className="chart-readout chart-readout-grid" aria-live="polite">
        <strong className="chart-readout-date"><time dateTime={selected.date}>{readoutDate(selected.date)}</time></strong>
        <dl>
          <div><dt><span className="legend-line swatch-maintenance-adapting" aria-hidden="true"/>Estimate</dt><dd>{displayEnergy(selected.kcal,energyUnit)} <small>{unit}/day</small></dd></div>
          <div><dt>Status</dt><dd><Status day={selected}/></dd></div>
        </dl>
      </div>
      <div className="chart-scrub" role="group" aria-label="Maintenance chart. Touch the chart or use the left and right arrow keys to read a date." aria-describedby={readoutId} {...scrub.groupProps}>
        <BarChartNav range={visibleSpan}/>
        <BarChartFrame viewport={viewport} height={height} axis={axis} plotProps={scrub.svgProps} pager="days"
          label={`Estimated maintenance across ${days.length} days; held on ${heldDays} of them.`}>
          {holds.map(run=><rect key={run.from} className="maintenance-hold-band" x={run.from*slot} y={TOP-6} width={(run.to-run.from+1)*slot} height={base-TOP+6}>
            <title>{readableDate(days[run.from].date)} to {readableDate(days[run.to].date)}: {holdLabel[run.kind]}</title>
          </rect>)}
          {ticks.map(value=><line key={value} x1={0} y1={y(value)} x2={contentWidth} y2={y(value)} className="chart-grid"/>)}
          <line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={TOP-6} y2={base} className="chart-crosshair"/>
          {lines.map(run=><polyline key={run.from} points={path(run.from,run.to)} className={run.held?'maintenance-trend-line is-held':'maintenance-trend-line'}/>)}
          <circle cx={x(selectedIndex)} cy={y(selected.kcal!)} r={5.5} className={selected.hold?'maintenance-dot is-held':'maintenance-dot'}/>
          {labelIndices.map(index=>{
            const at=x(index);
            return <text key={index} x={at} y={height-6} textAnchor={at<26?'start':at>contentWidth-26?'end':'middle'}>{dateLabel(days[index].date)}</text>;
          })}
        </BarChartFrame>
      </div>
      <ul className="chart-legend" aria-label="Maintenance chart key">
        <li><span className="legend-line swatch-maintenance-adapting" aria-hidden="true"/>Adapting</li>
        <li><span className="legend-swatch swatch-maintenance-hold" aria-hidden="true"/>Holding</li>
      </ul>
    </>:<div className="empty"><h3>No estimate yet</h3></div>}
  </section>;
}

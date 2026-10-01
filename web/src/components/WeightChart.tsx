import {useId,useState} from 'react';
import {SegmentedControl} from './ui/SegmentedControl';
import type {ProgressWeightPoint,WeightUnit} from '../types';
import {displayWeight,weightLabel,weightValue} from '../lib/units';
import {dateAxisOffsets,niceTicks} from '../lib/barChart';
import {dateSpan} from '../lib/chartLabels';
import {monthYear,readoutDate,shortDate} from '../lib/format';
import {BAR_AXIS_WIDTH,BarChartFrame,BarChartNav} from './ui/BarChartFrame';
import {useBarViewport,useRevealBar} from './ui/useBarViewport';
import {useChartScrub} from './ui/useChartScrub';

type View='both'|'scale'|'trend';
const TOP=16;
const BASE=184;
const HEIGHT=214;
const DAY=86400000;
/** A window shows this many calendar days per bar-chart slot before the rest is reached by scrolling or the page buttons. */
const DAYS_PER_BAR_SLOT=2;
const MAX_SCREENS=4;
const isoDay=(time:number)=>new Date(time).toISOString().slice(0,10);

export function WeightChart({series,weightUnit='kg'}:{series:ProgressWeightPoint[];weightUnit?:WeightUnit}){
  const [view,setView]=useState<View>('both');
  const readoutId=useId();
  const gradientId=`trend-fill-${useId().replace(/[^\w-]/g,'')}`;
  const unit=weightLabel(weightUnit);
  const start=series.length?Date.parse(series[0].date):0;
  const totalDays=series.length?Math.max(0,Math.round((Date.parse(series.at(-1)!.date)-start)/DAY)):0;
  // One slot per calendar day, so weigh-ins keep their true spacing. A long period never needs more than a few screens of scrolling.
  const viewport=useBarViewport(totalDays+1,base=>Math.max(base*DAYS_PER_BAR_SLOT,Math.ceil((totalDays+1)/MAX_SCREENS)));
  const {slot,contentWidth,edges}=viewport;
  const dayOf=(date:string)=>Math.round((Date.parse(date)-start)/DAY);
  const x=(date:string)=>slot*(dayOf(date)+.5);
  // Ticks are chosen in the display unit so the axis reads 170, 171 lb rather than converted kilograms.
  const shown=series.flatMap(point=>view==='scale'?[point.scaleKg]:view==='trend'?[point.trendKg]:[point.scaleKg,point.trendKg]).filter((value):value is number=>value!==null).map(kg=>weightValue(kg,weightUnit)!);
  const ticks=shown.length?niceTicks(Math.min(...shown),Math.max(...shown),4):[0,1];
  const low=ticks[0],high=ticks.at(-1)!;
  const valueY=(value:number)=>BASE-(value-low)/Math.max(1e-9,high-low)*(BASE-TOP);
  const y=(kg:number)=>valueY(weightValue(kg,weightUnit)!);
  const segments=(field:'scaleKg'|'trendKg')=>{
    const result:ProgressWeightPoint[][]=[];
    let active:ProgressWeightPoint[]=[];
    for(const point of series){
      if(point[field]===null){if(active.length)result.push(active);active=[];}
      else active.push(point);
    }
    if(active.length)result.push(active);
    return result;
  };
  const line=(points:ProgressWeightPoint[],field:'scaleKg'|'trendKg')=>points.map(point=>`${x(point.date)},${y(point[field]!)}`).join(' ');
  const area=(points:ProgressWeightPoint[])=>`M${x(points[0].date)} ${BASE} ${points.map(point=>`L${x(point.date)} ${y(point.trendKg!)}`).join(' ')} L${x(points.at(-1)!.date)} ${BASE} Z`;
  const scrub=useChartScrub(series.map(point=>x(point.date)),{tapToSelect:true});
  const selected=series[scrub.index];
  useRevealBar(viewport,selected?dayOf(selected.date):0);
  // Labels sit on whole days and stay apart; long periods label months instead of days, and a month shows once.
  const dateLabel=totalDays>200?monthYear:shortDate;
  const labelDates=series.length?dateAxisOffsets(totalDays,slot)
    .map(offset=>isoDay(start+offset*DAY))
    .filter((date,index,all)=>index===0||dateLabel(date)!==dateLabel(all[index-1])):[];
  const visibleSpan=series.length?dateSpan(isoDay(start+Math.min(edges.first,totalDays)*DAY),isoDay(start+Math.min(edges.last,totalDays)*DAY)):'';
  const viewName=view==='both'?'Scale and trend':view==='scale'?'Scale':'Trend';
  const axis=ticks.map(value=><text key={value} x={BAR_AXIS_WIDTH-8} y={valueY(value)+4} textAnchor="end">{value.toLocaleString('en-MY',{maximumFractionDigits:1})}</text>);
  return <section className="panel weight-chart-panel"><div className="section-heading"><div><h2>Weight</h2></div>
    <SegmentedControl<View> layout="equal" className="chart-view-toggle" label="Weight chart display" value={view} onChange={setView} options={[
      {value:'both',label:'Both',ariaLabel:'Both'},
      {value:'scale',label:<><span className="tab-label-full">Scale weight</span><span className="tab-label-short">Scale</span></>,ariaLabel:'Scale weight'},
      {value:'trend',label:<><span className="tab-label-full">Trend weight</span><span className="tab-label-short">Trend</span></>,ariaLabel:'Trend weight'}
    ]}/></div>
    {series.length&&selected?<>
    <div id={readoutId} className="chart-readout chart-readout-grid" aria-live="polite">
      <strong className="chart-readout-date"><time dateTime={selected.date}>{readoutDate(selected.date)}</time></strong>
      <dl>
        {view!=='trend'&&<div><dt><span className="legend-dot swatch-scale" aria-hidden="true"/>Scale</dt><dd>{displayWeight(selected.scaleKg,weightUnit,2)} {unit}</dd></div>}
        {view!=='scale'&&<div><dt><span className="legend-line swatch-trend" aria-hidden="true"/>Trend</dt><dd>{selected.trendKg===null?'Pending':`${displayWeight(selected.trendKg,weightUnit,2)} ${unit}`}</dd></div>}
        {view==='both'&&<div><dt>Scale vs trend</dt><dd>{selected.trendKg===null?'—':`${selected.scaleKg-selected.trendKg>=0?'+':'−'}${displayWeight(Math.abs(selected.scaleKg-selected.trendKg),weightUnit,2)} ${unit}`}</dd></div>}
      </dl>
    </div>
    <div className="chart-scrub" role="group" aria-label="Weight chart. Touch the chart or use the left and right arrow keys to read a date." aria-describedby={readoutId} {...scrub.groupProps}>
    <BarChartNav viewport={viewport} range={visibleSpan}/>
    <BarChartFrame viewport={viewport} height={HEIGHT} axis={axis} plotProps={scrub.svgProps} pager="days"
      label={`${viewName} weight chart across ${series.length} weigh-ins.`}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" className="trend-fill-start"/><stop offset="100%" className="trend-fill-end"/></linearGradient></defs>
      {ticks.map(value=><line key={value} x1={0} y1={valueY(value)} x2={contentWidth} y2={valueY(value)} className="chart-grid"/>)}
      {view!=='scale'&&segments('trendKg').filter(points=>points.length>1).map((points,index)=><path key={`area-${index}`} d={area(points)} fill={`url(#${gradientId})`} className="trend-area"/>)}
      <line x1={x(selected.date)} x2={x(selected.date)} y1={TOP-6} y2={BASE} className="chart-crosshair"/>
      {view!=='trend'&&<>
        {segments('scaleKg').map((points,index)=><polyline key={index} points={line(points,'scaleKg')} className="scale-line"/>)}
        {series.map(point=><circle key={`scale-${point.date}`} cx={x(point.date)} cy={y(point.scaleKg)} r={point===selected?5:2.75} className={point===selected?'scale-dot is-selected':'scale-dot'}><title>{point.date}: {displayWeight(point.scaleKg,weightUnit,2)} {unit} on the scale</title></circle>)}
      </>}
      {view!=='scale'&&<>
        {segments('trendKg').map((points,index)=><polyline key={index} points={line(points,'trendKg')} className="trend-line"/>)}
        {selected.trendKg!==null&&<circle cx={x(selected.date)} cy={y(selected.trendKg)} r={5.5} className="trend-dot is-selected"><title>{selected.date}: {displayWeight(selected.trendKg,weightUnit,2)} {unit} trend</title></circle>}
      </>}
      {labelDates.map(date=>{
        const at=x(date);
        return <text key={date} x={at} y={HEIGHT-6} textAnchor={at<26?'start':at>contentWidth-26?'end':'middle'}>{dateLabel(date)}</text>;
      })}
    </BarChartFrame></div>
    <ul className="chart-legend" aria-label="Weight chart key">
      {view!=='trend'&&<li><span className="legend-dot swatch-scale" aria-hidden="true"/>Scale weigh-in</li>}
      {view!=='scale'&&<li><span className="legend-line swatch-trend" aria-hidden="true"/>Trend</li>}
      <li>{unit}</li>
    </ul></>:<div className="empty"><h3>No weigh-ins yet</h3></div>}
  </section>;
}

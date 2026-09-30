import {useId,useState} from 'react';
import {SegmentedControl} from './ui/SegmentedControl';
import type {ProgressWeightPoint,WeightUnit} from '../types';
import {displayWeight,weightLabel,weightValue} from '../lib/units';
import {niceTicks} from '../lib/barChart';
import {monthYear,readoutDate,shortDate} from '../lib/format';
import {useChartLayout} from './ui/useChartLayout';
import {useChartScrub} from './ui/useChartScrub';

type View='both'|'scale'|'trend';
const TOP=16;
const BASE=184;
const HEIGHT=214;
const DAY=86400000;

export function WeightChart({series,weightUnit='kg'}:{series:ProgressWeightPoint[];weightUnit?:WeightUnit}){
  const [view,setView]=useState<View>('both');
  const chart=useChartLayout();
  const readoutId=useId();
  const gradientId=`trend-fill-${useId().replace(/[^\w-]/g,'')}`;
  const unit=weightLabel(weightUnit);
  // Ticks are chosen in the display unit so the axis reads 170, 171 lb rather than converted kilograms.
  const shown=series.flatMap(point=>view==='scale'?[point.scaleKg]:view==='trend'?[point.trendKg]:[point.scaleKg,point.trendKg]).filter((value):value is number=>value!==null).map(kg=>weightValue(kg,weightUnit)!);
  const ticks=shown.length?niceTicks(Math.min(...shown),Math.max(...shown),4):[0,1];
  const low=ticks[0],high=ticks.at(-1)!;
  const start=series.length?Date.parse(series[0].date):0;
  const duration=Math.max(DAY,series.length?Date.parse(series.at(-1)!.date)-start:0);
  const x=(date:string)=>chart.left+(Date.parse(date)-start)/duration*chart.plotWidth;
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
  const scrub=useChartScrub(series.map(point=>x(point.date)));
  const selected=series[scrub.index];
  // About one date label per 110 px; long periods label months instead of days.
  const tickCount=Math.max(2,Math.min(6,Math.floor(chart.plotWidth/110)+1));
  const dateTicks:string[]=series.length>1
    ?Array.from({length:tickCount},(_,index)=>new Date(start+duration*index/(tickCount-1)).toISOString().slice(0,10))
    :series.map(point=>point.date);
  const dateLabel=duration>200*DAY?monthYear:shortDate;
  const viewName=view==='both'?'Scale and trend':view==='scale'?'Scale':'Trend';
  return <section className="panel weight-chart-panel"><div className="section-heading"><div><h2>Weight</h2><p>Scale weigh-ins bounce with water and food; the trend smooths them to show real change.</p></div>
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
    <svg ref={chart.ref} viewBox={`0 0 ${chart.width} ${HEIGHT}`} className="weight-chart" role="img" aria-label={`${viewName} weight chart across ${series.length} weigh-ins.`} {...scrub.svgProps}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" className="trend-fill-start"/><stop offset="100%" className="trend-fill-end"/></linearGradient></defs>
      {ticks.map(value=><g key={value}><line x1={chart.left} y1={valueY(value)} x2={chart.right} y2={valueY(value)} className="chart-grid"/><text x={chart.left-8} y={valueY(value)+4} textAnchor="end">{value.toLocaleString('en-MY',{maximumFractionDigits:1})}</text></g>)}
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
      {dateTicks.map((date,index)=><text key={date} x={x(date)} y={HEIGHT-6} textAnchor={index===0?'start':index===dateTicks.length-1?'end':'middle'}>{dateLabel(date)}</text>)}
    </svg></div>
    <ul className="chart-legend" aria-label="Weight chart key">
      {view!=='trend'&&<li><span className="legend-dot swatch-scale" aria-hidden="true"/>Scale weigh-in</li>}
      {view!=='scale'&&<li><span className="legend-line swatch-trend" aria-hidden="true"/>Trend (smoothed)</li>}
      <li>{unit}</li>
    </ul></>:<div className="empty"><h3>No weigh-ins yet</h3><p>Add a weigh-in to start your scale and trend lines.</p></div>}
  </section>;
}

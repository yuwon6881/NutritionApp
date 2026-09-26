import {useId,useState} from 'react';
import {SegmentedControl} from './ui/SegmentedControl';
import type {ProgressWeightPoint,WeightUnit} from '../types';
import {displayWeight,weightLabel} from '../lib/units';
import {useChartLayout} from './ui/useChartLayout';
import {useChartScrub} from './ui/useChartScrub';

export function WeightChart({series,weightUnit='kg'}:{series:ProgressWeightPoint[];weightUnit?:WeightUnit}){
  const [view,setView]=useState<'both'|'daily'|'trend'>('both');
  const chart=useChartLayout();
  const readoutId=useId();
  const values=series.flatMap(point=>view==='daily'?[point.scaleKg]:view==='trend'?[point.trendKg]:[point.scaleKg,point.trendKg]).filter((value):value is number=>value!==null);
  const min=values.length?Math.min(...values)-.5:0;
  const max=values.length?Math.max(...values)+.5:1;
  const start=series.length?Date.parse(series[0].date):0;
  const duration=Math.max(86400000,series.length?Date.parse(series.at(-1)!.date)-start:0);
  const x=(date:string)=>chart.left+(Date.parse(date)-start)/duration*chart.plotWidth;
  const y=(value:number)=>180-(value-min)/(max-min)*140;
  const segments=(field:'scaleKg'|'trendKg')=>{
    const result:string[][]=[];
    let active:string[]=[];
    for(const point of series){
      const value=point[field];
      if(value===null){if(active.length)result.push(active);active=[];}
      else active.push(`${x(point.date)},${y(value)}`);
    }
    if(active.length)result.push(active);
    return result.map(segment=>segment.join(' '));
  };
  const scrub=useChartScrub(series.map(point=>x(point.date)));
  const selected=series[scrub.index];
  const unit=weightLabel(weightUnit);
  return <section className="panel"><div className="section-heading"><div><h2>Weight</h2></div>
    <SegmentedControl<'both'|'daily'|'trend'> layout="equal" className="chart-view-toggle" label="Weight chart display" value={view} onChange={setView} options={[
      {value:'both',label:'Both',ariaLabel:'Both'},
      {value:'daily',label:<><span className="tab-label-full">Daily weight</span><span className="tab-label-short">Daily</span></>,ariaLabel:'Daily weight'},
      {value:'trend',label:<><span className="tab-label-full">Trend weight</span><span className="tab-label-short">Trend</span></>,ariaLabel:'Trend weight'}
    ]}/></div>
    {series.length&&selected?<>
    <p id={readoutId} className="chart-readout" aria-live="polite">
      <strong>{selected.date}</strong>
      {view!=='trend'&&<span>Scale {displayWeight(selected.scaleKg,weightUnit,2)} {unit}</span>}
      {view!=='daily'&&<span>Trend {selected.trendKg===null?'Pending':`${displayWeight(selected.trendKg,weightUnit,2)} ${unit}`}</span>}
    </p>
    <div className="chart-scrub" role="group" aria-label="Weight chart. Touch the chart or use the left and right arrow keys to read a date." aria-describedby={readoutId} {...scrub.groupProps}>
    <svg ref={chart.ref} viewBox={`0 0 ${chart.width} 220`} className="weight-chart" role="img" aria-label={`${view==='both'?'Daily and trend':view==='daily'?'Daily scale':'Trend'} weight chart across ${series.length} points. Values are also available in the table below.`} {...scrub.svgProps}>
    {[min,(min+max)/2,max].map(value=><g key={value}><line x1={chart.left} y1={y(value)} x2={chart.right} y2={y(value)} className="chart-grid"/><text x={chart.left-8} y={y(value)+4} textAnchor="end">{displayWeight(value,weightUnit,1)}</text></g>)}
    <line x1={x(selected.date)} x2={x(selected.date)} y1="36" y2="184" className="chart-crosshair"/>
    {view!=='trend'&&<>{segments('scaleKg').map((points,index)=><polyline key={index} points={points} className="scale-line"/>)}{series.map(point=><circle key={`scale-${point.date}`} cx={x(point.date)} cy={y(point.scaleKg)} r={point===selected?5:2.5} className="scale-dot"><title>{point.date}: {displayWeight(point.scaleKg,weightUnit,2)} {unit} scale weight</title></circle>)}</>}
    {view!=='daily'&&<>{segments('trendKg').map((points,index)=><polyline key={index} points={points} className="trend-line"/>)}{series.map(point=>point.trendKg===null?null:<circle key={`trend-${point.date}`} cx={x(point.date)} cy={y(point.trendKg)} r={point===selected?5:2} className="trend-dot"><title>{point.date}: {displayWeight(point.trendKg,weightUnit,2)} {unit} trend weight</title></circle>)}</>}
    <text x={chart.left} y="208">{series[0].date}</text><text x={chart.right} y="208" textAnchor="end">{series.at(-1)!.date}</text></svg></div><p className="chart-key">Muted: scale weight · Accent: trend weight · {unit}</p>
    <details><summary>Values as a table</summary><div className="table-scroll"><table><thead><tr><th>Date</th><th>Daily {unit}</th><th>Trend {unit}</th></tr></thead><tbody>{series.map(point=><tr key={point.date}><td>{point.date}</td><td>{displayWeight(point.scaleKg,weightUnit,2)}</td><td>{point.trendKg===null?'Pending':displayWeight(point.trendKg,weightUnit,2)}</td></tr>)}</tbody></table></div></details></>:<div className="empty"><h3>No weigh-ins yet</h3></div>}
  </section>;
}

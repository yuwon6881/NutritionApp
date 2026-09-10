import {useState} from 'react';
import {SegmentedControl} from './ui/SegmentedControl';
import type {WeightUnit} from '../types';
import {displayWeight,weightLabel} from '../lib/units';
import {useChartLayout} from './ui/useChartLayout';
type Point={date:string;kg:number};
export function WeightChart({weights,smoothed,weightUnit='kg'}:{weights:Point[];smoothed:Point[];weightUnit?:WeightUnit}){
  const [view,setView]=useState<'both'|'daily'|'trend'>('both');
  const chart=useChartLayout();
  const values=view==='daily'?weights:view==='trend'?smoothed:[...weights,...smoothed];
  const min=values.length?Math.min(...values.map(w=>w.kg))-.5:0;const max=values.length?Math.max(...values.map(w=>w.kg))+.5:1;
  const start=weights.length?Date.parse(weights[0].date):0;const duration=Math.max(86400000,weights.length?Date.parse(weights.at(-1)!.date)-start:0);
  const x=(p:Point)=>chart.left+(Date.parse(p.date)-start)/duration*chart.plotWidth;const y=(p:Point)=>180-(p.kg-min)/(max-min)*140;
  const points=(items:Point[])=>items.map(p=>`${x(p)},${y(p)}`).join(' ');
  return <section className="panel"><div className="section-heading"><div><h2>Weight</h2></div>
    <SegmentedControl<'both'|'daily'|'trend'> layout="equal" className="chart-view-toggle" label="Weight chart display" value={view} onChange={setView} options={[
      {value:'both',label:'Both',ariaLabel:'Both'},
      {value:'daily',label:<><span className="tab-label-full">Daily weight</span><span className="tab-label-short">Daily</span></>,ariaLabel:'Daily weight'},
      {value:'trend',label:<><span className="tab-label-full">Trend weight</span><span className="tab-label-short">Trend</span></>,ariaLabel:'Trend weight'}
    ]}/></div>
    {weights.length?<><svg ref={chart.ref} viewBox={`0 0 ${chart.width} 220`} className="weight-chart" role="img" aria-label={`${view==='both'?'Daily and trend':view==='daily'?'Daily scale':'Trend'} weight chart across ${weights.length} weigh-ins. Values are also available in the table below.`}>
    {[min,(min+max)/2,max].map(v=><g key={v}><line x1={chart.left} y1={y({date:'',kg:v})} x2={chart.right} y2={y({date:'',kg:v})} className="chart-grid"/><text x={chart.left-8} y={y({date:'',kg:v})+4} textAnchor="end">{displayWeight(v,weightUnit,1)}</text></g>)}
    {view!=='trend'&&<><polyline points={points(weights)} className="scale-line"/>{weights.map(p=><circle key={p.date} cx={x(p)} cy={y(p)} r="2.5" className="scale-dot"><title>{p.date}: {displayWeight(p.kg,weightUnit,2)} {weightLabel(weightUnit)} scale weight</title></circle>)}</>}
    {view!=='daily'&&<><polyline points={points(smoothed)} className="trend-line"/>{smoothed.map(p=><circle key={p.date} cx={x(p)} cy={y(p)} r="2" className="trend-dot"><title>{p.date}: {displayWeight(p.kg,weightUnit,2)} {weightLabel(weightUnit)} trend weight</title></circle>)}</>}
    <text x={chart.left} y="208">{weights[0].date}</text><text x={chart.right} y="208" textAnchor="end">{weights.at(-1)!.date}</text></svg><p className="chart-key">Muted: scale weight · Accent: trend weight · {weightLabel(weightUnit)}</p>
    <details><summary>Values as a table</summary><div className="table-scroll"><table><thead><tr><th>Date</th><th>Daily {weightLabel(weightUnit)}</th><th>Trend {weightLabel(weightUnit)}</th></tr></thead><tbody>{weights.map((p,i)=><tr key={p.date}><td>{p.date}</td><td>{displayWeight(p.kg,weightUnit,2)}</td><td>{displayWeight(smoothed[i]?.kg,weightUnit,2)}</td></tr>)}</tbody></table></div></details></>:<div className="empty"><h3>No weigh-ins yet</h3></div>}
  </section>;
}

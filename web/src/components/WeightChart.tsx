import {useState} from 'react';
import {number} from '../lib/format';
import {Button} from './ui/Button';
type Point={date:string;kg:number};
export function WeightChart({weights,smoothed}:{weights:Point[];smoothed:Point[]}){
  const [view,setView]=useState<'both'|'daily'|'trend'>('both');
  const values=view==='daily'?weights:view==='trend'?smoothed:[...weights,...smoothed];
  const min=values.length?Math.min(...values.map(w=>w.kg))-.5:0;const max=values.length?Math.max(...values.map(w=>w.kg))+.5:1;
  const start=weights.length?Date.parse(weights[0].date):0;const duration=Math.max(86400000,weights.length?Date.parse(weights.at(-1)!.date)-start:0);
  const x=(p:Point)=>55+(Date.parse(p.date)-start)/duration*615;const y=(p:Point)=>180-(p.kg-min)/(max-min)*140;
  const points=(items:Point[])=>items.map(p=>`${x(p)},${y(p)}`).join(' ');
  return <section className="panel"><div className="section-heading"><div><h2>The direction over time</h2><p>Scale weight and a calculated trend with a seven-day smoothing half-life.</p></div></div>
    <div className="actions" role="group" aria-label="Weight chart display">{([['both','Both'],['daily','Daily weight'],['trend','Calculated trend']] as const).map(([id,label])=><Button key={id} variant={view===id?'primary':'secondary'} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</Button>)}</div>
    {weights.length?<><svg viewBox="0 0 700 220" className="weight-chart" role="img" aria-label={`${view==='both'?'Daily and calculated':view==='daily'?'Daily scale':'Calculated trend'} weight chart across ${weights.length} weigh-ins. Values are also available in the table below.`}>
    {[min,(min+max)/2,max].map(v=><g key={v}><line x1="55" y1={y({date:'',kg:v})} x2="670" y2={y({date:'',kg:v})} className="chart-grid"/><text x="48" y={y({date:'',kg:v})+4} textAnchor="end">{number(v,1)}</text></g>)}
    {view!=='trend'&&<><polyline points={points(weights)} className="scale-line"/>{weights.map(p=><circle key={p.date} cx={x(p)} cy={y(p)} r="2.5" className="scale-dot"><title>{p.date}: {number(p.kg,2)} kg scale weight</title></circle>)}</>}
    {view!=='daily'&&<><polyline points={points(smoothed)} className="trend-line"/>{smoothed.map(p=><circle key={p.date} cx={x(p)} cy={y(p)} r="2" className="trend-dot"><title>{p.date}: {number(p.kg,2)} kg calculated trend</title></circle>)}</>}
    <text x="55" y="208">{weights[0].date}</text><text x="670" y="208" textAnchor="end">{weights.at(-1)!.date}</text></svg><p className="chart-key">Muted: recorded scale weight · Accent: calculated trend · kg</p>
    <details><summary>Weight values as a table</summary><div className="table-scroll"><table><thead><tr><th>Date</th><th>Daily kg</th><th>Calculated kg</th></tr></thead><tbody>{weights.map((p,i)=><tr key={p.date}><td>{p.date}</td><td>{number(p.kg,2)}</td><td>{number(smoothed[i]?.kg,2)}</td></tr>)}</tbody></table></div></details></>:<div className="empty"><h3>Your story starts with one weigh-in</h3><p>Try weighing under similar conditions, ideally in the morning.</p></div>}
    <details className="chart-details"><summary>About smoothing & measurements</summary><p className="source">Smoothing reduces daily noise but lags changes. It cannot measure fat, muscle or water separately. Unrecorded days are not presented as measured weigh-ins.</p></details>
  </section>;
}

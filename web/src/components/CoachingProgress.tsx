import {useEffect,useState} from 'react';
import type {Nourish} from '../useNourish';
import type {CoachResult} from '../types';
import {api} from '../lib/api';
import {number} from '../lib/format';
import {GoalSummary} from './GoalSummary';
export function CoachingProgress({store}:{store:Nourish}){
  const [result,setResult]=useState<CoachResult>();const [error,setError]=useState('');
  const pending=store.local!.queue.length>0;
  useEffect(()=>{let active=true;if(!pending)void api<{result:CoachResult}>('/coach/preview').then(p=>{if(active){setResult(p.result);setError('');}}).catch(ex=>{if(active)setError(ex.message);});return()=>{active=false;};},[store.state!.revision,pending]);
  const points=store.state!.plans.map(p=>({date:p.date,revision:p.revision,result:JSON.parse(p.resultJson) as CoachResult})).filter(p=>p.result.expenditure!=null).sort((a,b)=>a.revision-b.revision);
  const min=Math.min(...points.map(p=>p.result.expenditure!),result?.expenditure??2500)-100;const max=Math.max(...points.map(p=>p.result.expenditure!),result?.expenditure??2500)+100;
  const start=points.length?Date.parse(points[0].date):0;const duration=Math.max(86400000,points.length?Date.parse(points.at(-1)!.date)-start:0);
  const xy=(p:typeof points[number])=>`${55+(Date.parse(p.date)-start)/duration*615},${175-(p.result.expenditure!-min)/(max-min)*130}`;
  return <section className="panel">
    <div className="section-heading"><div><h2>Maintenance estimate</h2></div>{!pending&&result&&<strong className="figure-inline">{number(result.expenditure)} <span className="unit">kcal/day</span></strong>}</div>
    {pending?<p className="notice">Sync your changes to update this estimate.</p>:result?.goalProgress&&<GoalSummary progress={result.goalProgress}/>}
    {points.length>0&&<svg viewBox="0 0 700 220" className="weight-chart" role="img" aria-label={`Accepted maintenance estimates from ${number(points[0].result.expenditure)} to ${number(points.at(-1)!.result.expenditure)} calories per day.`}><line x1="55" y1="175" x2="670" y2="175" className="chart-grid"/><polyline className="trend-line" points={points.map(xy).join(' ')}/>{points.map(p=>{const [x,y]=xy(p).split(',');return <circle key={p.revision} cx={x} cy={y} r="3" className="trend-dot"><title>{p.date}: {number(p.result.expenditure)} kcal/day</title></circle>;})}<text x="50" y="45" textAnchor="end">{number(max)}</text><text x="50" y="175" textAnchor="end">{number(min)}</text><text x="55" y="208">{points[0].date}</text><text x="670" y="208" textAnchor="end">{points.at(-1)!.date}</text></svg>}
    {error&&<p className="source">Offline · saved history shown.</p>}
  </section>;
}

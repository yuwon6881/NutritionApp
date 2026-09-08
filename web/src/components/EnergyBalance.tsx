import {useState} from 'react';
import type {Nourish} from '../useNourish';
import type {CoachResult} from '../types';
import {energyDays,groupEnergy,shiftDate} from '../lib/energyBalance';
import {number,today} from '../lib/format';
import {SelectField} from './ui/Field';
export function EnergyBalance({store}:{store:Nourish}){
  const [period,setPeriod]=useState('7');const [group,setGroup]=useState<'day'|'week'|'month'>('day');const state=store.state!;
  const end=[state.end,today(state.profile?.timeZone)].sort()[0];const start=[state.start,shiftDate(end,1-Number(period))].sort().at(-1)!;
  const estimates=state.energyEstimates??state.plans.map(p=>({date:p.date,revision:p.revision,expenditure:(JSON.parse(p.resultJson) as CoachResult).expenditure!})).filter(p=>p.expenditure!=null);
  const daily=energyDays({entries:state.entries,days:state.days,estimates},start,end);const rows=groupEnergy(daily,group);
  const ceiling=Math.max(100,...rows.flatMap(r=>[r.intake??0,r.maintenance??0]));const balanceMax=Math.max(100,...rows.map(r=>Math.abs(r.balance??0)));
  const slot=620/Math.max(1,rows.length);const bar=Math.min(25,slot*.32);const x=(i:number)=>55+slot*(i+.5);
  const energyY=(value:number)=>185-value/ceiling*145;const netY=(value:number)=>110-value/balanceMax*65;
  const tick=(i:number)=>i%Math.max(1,Math.ceil(rows.length/6))===0;
  const complete=daily.filter(r=>r.balance!=null);const total=complete.reduce((sum,r)=>sum+r.balance!,0);
  return <section className="panel energy-history"><div className="section-heading"><div><h2>Your energy balance</h2><p>Logged intake compared with the accepted maintenance estimate in effect on each date.</p></div></div>
    <div className="form-grid"><SelectField label="Energy history period" value={period} onChange={setPeriod}><option value="7">Last 7 days</option><option value="28">Last 28 days</option><option value="90">Last 90 days</option><option value="366">Selected history window</option></SelectField><SelectField label="Group energy bars by" value={group} onChange={v=>setGroup(v as typeof group)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></SelectField></div>
    <p className="source">{start} to {end}. Weekly/monthly bars are totals for the included dates, including partial calendar periods.</p>
    <h3>Intake and estimated maintenance</h3><svg viewBox="0 0 700 225" className="weight-chart" role="img" aria-label={`Energy intake and estimated maintenance bars, grouped by ${group}, from ${start} to ${end}. Exact values and incomplete days are in the table.`}>
      {[0,ceiling/2,ceiling].map(value=><g key={value}><line x1="55" x2="675" y1={energyY(value)} y2={energyY(value)} className="chart-grid"/><text x="48" y={energyY(value)+4} textAnchor="end">{number(value)}</text></g>)}
      {rows.map((r,i)=><g key={r.date}>{r.intake!=null&&<rect x={x(i)-bar-1} y={energyY(r.intake)} width={bar} height={185-energyY(r.intake)} className={r.complete?'energy-intake':'energy-intake partial-bar'}><title>{r.date} to {r.end}: {number(r.intake)} kcal logged{r.complete?'':'; incomplete'}</title></rect>}{r.maintenance!=null&&<rect x={x(i)+1} y={energyY(r.maintenance)} width={bar} height={185-energyY(r.maintenance)} className="energy-maintenance"><title>{number(r.maintenance)} kcal estimated maintenance</title></rect>}{tick(i)&&<text x={x(i)} y="211" textAnchor="middle">{r.date.slice(5)}</text>}</g>)}
    </svg><p className="chart-key">Accent: logged intake · Muted: estimated maintenance · Faded intake: incomplete · kcal</p>
    <h3>Estimated surplus or deficit</h3><svg viewBox="0 0 700 225" className="weight-chart" role="img" aria-label={`Signed energy balance by ${group}. Positive values are surplus; negative values are deficit. Missing or incomplete groups have no balance bar.`}>
      <line x1="55" x2="675" y1="110" y2="110" className="chart-grid"/><text x="48" y="49" textAnchor="end">+{number(balanceMax)}</text><text x="48" y="114" textAnchor="end">0</text><text x="48" y="179" textAnchor="end">−{number(balanceMax)}</text>
      {rows.map((r,i)=><g key={r.date}>{r.balance!=null?<rect x={x(i)-bar/2} y={Math.min(110,netY(r.balance))} width={bar} height={Math.max(1,Math.abs(netY(r.balance)-110))} className={r.balance>=0?'energy-surplus':'energy-deficit'}><title>{r.date} to {r.end}: {r.balance>0?'+':''}{number(r.balance)} kcal</title></rect>:<text x={x(i)} y="114" textAnchor="middle">?</text>}{tick(i)&&<text x={x(i)} y="211" textAnchor="middle">{r.date.slice(5)}</text>}</g>)}
    </svg><p>{complete.length?<>Balance across {complete.length} fully logged days with known maintenance: <strong>{total>0?'+':''}{number(total)} kcal</strong>.</>:'No complete days with an accepted maintenance estimate in this window.'}</p>
    <details className="chart-details"><summary>About energy balance & symbols</summary><p className="source">Positive = surplus; negative = deficit. A question mark means incomplete logging or unavailable historical maintenance. Grouped balance is withheld if any included day is unknown. This energy estimate is not a direct measure of fat change.</p></details>
    <details><summary>Energy values as a table</summary><div className="table-scroll"><table><thead><tr><th>Period</th><th>Intake kcal</th><th>Maintenance kcal</th><th>Balance kcal</th><th>Logging</th></tr></thead><tbody>{rows.map(r=><tr key={r.date}><td>{r.date}{r.end!==r.date?` to ${r.end}`:''}</td><td>{number(r.intake)}</td><td>{number(r.maintenance)}</td><td>{r.balance!=null&&r.balance>0?'+':''}{number(r.balance)}</td><td>{r.complete?'Complete':r.loggedDays?'Partial':'No log'}</td></tr>)}</tbody></table></div></details>
  </section>;
}

import {useState} from 'react';
import type {Nourish} from '../useNourish';
import type {CoachResult} from '../types';
import {energyDays,groupEnergy,shiftDate} from '../lib/energyBalance';
import {today} from '../lib/format';
import {SelectField} from './ui/Field';
import {Button} from './ui/Button';
import {useHistoryWindow} from '../useHistoryWindow';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {useChartLayout} from './ui/useChartLayout';
export function EnergyBalance({store}:{store:Nourish}){
  const [period,setPeriod]=useState('7');const [group,setGroup]=useState<'day'|'week'|'month'>('day');
  const chart=useChartLayout();
  const history=useHistoryWindow(store,period.length===4?period:'recent');const state=history.state??store.state!;
  const units=unitsFor(state.settings);const energyUnit=energyLabel(units.energy);
  const end=[state.end,today(state.profile?.timeZone)].sort()[0];const start=period.length===4?state.start:[state.start,shiftDate(end,1-Number(period))].sort().at(-1)!;
  const estimates=(state.energyEstimates??[]).filter(p=>p.expenditure!=null).map(p=>({date:p.date,revision:p.revision,expenditure:p.expenditure!}));
  const fallbackEstimates=estimates.length?estimates:state.plans.map(p=>({date:p.date,revision:p.revision,expenditure:(JSON.parse(p.resultJson) as CoachResult).expenditure!})).filter(p=>p.expenditure!=null);
  const daily=energyDays({entries:state.entries,days:state.days,estimates:fallbackEstimates,current:today(state.profile?.timeZone)},start,end);const rows=groupEnergy(daily,group);
  const ceiling=Math.max(100,...rows.flatMap(r=>[r.intake??0,r.maintenance??0]));const balanceMax=Math.max(100,...rows.map(r=>Math.abs(r.balance??0)));
  const slot=chart.plotWidth/Math.max(1,rows.length);const bar=Math.min(25,slot*.32);const x=(i:number)=>chart.left+slot*(i+.5);
  const energyY=(value:number)=>185-value/ceiling*145;const netY=(value:number)=>110-value/balanceMax*65;
  const tick=(i:number)=>i%Math.max(1,Math.ceil(rows.length/Math.max(2,Math.floor(chart.plotWidth/65))))===0;
  const complete=daily.filter(r=>r.balance!=null);const total=complete.reduce((sum,r)=>sum+r.balance!,0);
  return <section className="panel energy-history"><div className="section-heading"><div><h2>Energy balance</h2><p>{start} to {end}</p></div></div>
    <div className="form-grid"><SelectField label="Energy history period" value={period} onChange={setPeriod}><option value="7">Last 7 days</option><option value="28">Last 28 days</option><option value="90">Last 90 days</option>{Array.from({length:Number(today(state.profile?.timeZone).slice(0,4))-1999},(_,i)=>String(Number(today(state.profile?.timeZone).slice(0,4))-i)).map(y=><option key={y} value={y}>{y}</option>)}</SelectField><SelectField label="Group energy bars by" value={group} onChange={v=>setGroup(v as typeof group)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></SelectField></div>
    {history.error&&<p className="notice" role="status">{history.state?'Saved history shown.':'This history is not available on this device.'} {history.error} <Button onClick={history.retry}>Retry history</Button></p>}
    {!history.state&&!history.error&&<p role="status">Loading energy history…</p>}
    {history.state&&<>
    <h3>Intake and estimated maintenance</h3><svg ref={chart.ref} viewBox={`0 0 ${chart.width} 225`} className="weight-chart" role="img" aria-label={`Energy intake and estimated maintenance bars, grouped by ${group}, from ${start} to ${end}. Exact values and incomplete days are in the table.`}>
      {[0,ceiling/2,ceiling].map(value=><g key={value}><line x1={chart.left} x2={chart.right} y1={energyY(value)} y2={energyY(value)} className="chart-grid"/><text x={chart.left-8} y={energyY(value)+4} textAnchor="end">{displayEnergy(value,units.energy)}</text></g>)}
      {rows.map((r,i)=><g key={r.date}>{r.intake!=null&&<rect x={x(i)-bar-1} y={energyY(r.intake)} width={bar} height={185-energyY(r.intake)} className={r.complete?'energy-intake':'energy-intake partial-bar'}><title>{r.date} to {r.end}: {displayEnergy(r.intake,units.energy)} {energyUnit} logged{r.complete?'':'; incomplete'}</title></rect>}{r.maintenance!=null&&<rect x={x(i)+1} y={energyY(r.maintenance)} width={bar} height={185-energyY(r.maintenance)} className="energy-maintenance"><title>{displayEnergy(r.maintenance,units.energy)} {energyUnit} estimated maintenance</title></rect>}{tick(i)&&<text x={x(i)} y="211" textAnchor="middle">{r.date.slice(5)}</text>}</g>)}
    </svg><p className="chart-key">Accent: intake · Muted: maintenance · Faded: incomplete · {energyUnit}</p>
    <h3>Surplus or deficit</h3><svg viewBox={`0 0 ${chart.width} 225`} className="weight-chart" role="img" aria-label={`Signed energy balance by ${group}. Positive values are surplus; negative values are deficit. Missing or incomplete groups have no balance bar.`}>
      <line x1={chart.left} x2={chart.right} y1="110" y2="110" className="chart-grid"/><text x={chart.left-8} y="49" textAnchor="end">+{displayEnergy(balanceMax,units.energy)}</text><text x={chart.left-8} y="114" textAnchor="end">0</text><text x={chart.left-8} y="179" textAnchor="end">−{displayEnergy(balanceMax,units.energy)}</text>
      {rows.map((r,i)=><g key={r.date}>{r.balance!=null?<rect x={x(i)-bar/2} y={Math.min(110,netY(r.balance))} width={bar} height={Math.max(1,Math.abs(netY(r.balance)-110))} className={r.balance>=0?'energy-surplus':'energy-deficit'}><title>{r.date} to {r.end}: {r.balance>0?'+':''}{displayEnergy(r.balance,units.energy)} {energyUnit}</title></rect>:<text x={x(i)} y="114" textAnchor="middle">?</text>}{tick(i)&&<text x={x(i)} y="211" textAnchor="middle">{r.date.slice(5)}</text>}</g>)}
    </svg><p className="chart-key">{complete.length?<>{complete.length} complete days · <strong>{total>0?'+':''}{displayEnergy(total,units.energy)} {energyUnit}</strong></>:'No complete days with an accepted maintenance estimate.'}</p>
    <details><summary>Values as a table</summary><div className="table-scroll"><table><thead><tr><th>Period</th><th>Intake {energyUnit}</th><th>Maintenance {energyUnit}</th><th>Balance {energyUnit}</th><th>Logging</th></tr></thead><tbody>{rows.map(r=><tr key={r.date}><td>{r.date}{r.end!==r.date?` to ${r.end}`:''}</td><td>{displayEnergy(r.intake,units.energy)}</td><td>{displayEnergy(r.maintenance,units.energy)}</td><td>{r.balance!=null&&r.balance>0?'+':''}{displayEnergy(r.balance,units.energy)}</td><td>{r.complete?'Complete':r.loggedDays?'Partial':'No log'}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}

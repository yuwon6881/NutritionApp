import type {Nourish} from '../useNourish';
import type {ProgressPeriod,ProgressSummary} from '../types';
import {SelectField} from './ui/Field';
import {Button} from './ui/Button';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {useChartLayout} from './ui/useChartLayout';
import {progressPeriodOptions} from '../lib/progress';

export function EnergyBalance({store,period,summary,error,onPeriodChange}:{store:Nourish;period:ProgressPeriod;summary?:ProgressSummary;error?:string;onPeriodChange:(period:ProgressPeriod)=>void}){
  const chart=useChartLayout();
  const state=store.state!;
  const units=unitsFor(state.settings);
  const energyUnit=energyLabel(units.energy);
  const rows=summary?.energy.series??[];
  const grouping=summary?.grouping.energy??'daily';
  const ceiling=Math.max(100,...rows.flatMap(row=>[row.intake??0,row.maintenance??0]));
  const balanceMax=Math.max(100,...rows.map(row=>Math.abs(row.balance??0)));
  const slot=chart.plotWidth/Math.max(1,rows.length);
  const bar=Math.min(25,slot*.32);
  const x=(index:number)=>chart.left+slot*(index+.5);
  const energyY=(value:number)=>185-value/ceiling*145;
  const netY=(value:number)=>110-value/balanceMax*65;
  const tick=(index:number)=>index%Math.max(1,Math.ceil(rows.length/Math.max(2,Math.floor(chart.plotWidth/65))))===0;
  const complete=rows.filter(row=>row.balance!=null);
  const stats=summary?.energy.statistics;
  return <section className="panel energy-history"><div className="section-heading"><div><h2>Energy balance</h2><p>{summary?`${summary.start} to ${summary.end}`:'Loading the selected period…'}</p></div><SelectField label="Energy history period" value={period} onChange={value=>onPeriodChange(value as ProgressPeriod)}>
    {progressPeriodOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
  </SelectField></div>
    {error&&<p className="notice" role="status">{summary?'Saved summary shown.':'This summary is not available on this device.'} {error} <Button onClick={()=>void store.refreshProgress(period)}>Retry summary</Button></p>}
    {!summary&&!error&&<div className="skeleton" aria-busy="true" style={{minHeight:320}}/>}
    {summary&&<>
      {summary.awaitingSynchronization&&<p className="notice" role="status">Recent edits are retained locally and this summary will refresh after synchronization.</p>}
      <div className="stats-grid progress-energy-stats">
        <section><p className="eyebrow">COMPLETE DAYS</p><h3>{stats?.completeDays??0}</h3><p>of {stats?.days??0} dates</p></section>
        <section><p className="eyebrow">AVERAGE INTAKE</p><h3>{displayEnergy(stats?.averageIntake,units.energy)} <span className="unit">{energyUnit}</span></h3><p>{stats?.loggedDays??0} dates with intake</p></section>
        <section><p className="eyebrow">TOTAL BALANCE</p><h3>{stats?.totalBalance==null?'—':`${stats.totalBalance>0?'+':''}${displayEnergy(stats.totalBalance,units.energy)}`} <span className="unit">{energyUnit}</span></h3><p>{stats?.surplusDays??0} surplus · {stats?.deficitDays??0} deficit</p></section>
      </div>
      <h3>Intake and estimated maintenance</h3><svg ref={chart.ref} viewBox={`0 0 ${chart.width} 225`} className="weight-chart" role="img" aria-label={`Energy intake and estimated maintenance bars, grouped ${grouping}, from ${summary.start} to ${summary.end}.`}>
        {[0,ceiling/2,ceiling].map(value=><g key={value}><line x1={chart.left} x2={chart.right} y1={energyY(value)} y2={energyY(value)} className="chart-grid"/><text x={chart.left-8} y={energyY(value)+4} textAnchor="end">{displayEnergy(value,units.energy)}</text></g>)}
        {rows.map((row,index)=><g key={`${row.date}-${row.end}`}>{row.intake!=null&&<rect x={x(index)-bar-1} y={energyY(row.intake)} width={bar} height={185-energyY(row.intake)} className={row.complete?'energy-intake':'energy-intake partial-bar'}><title>{row.date} to {row.end}: {displayEnergy(row.intake,units.energy)} {energyUnit} logged{row.complete?'':'; incomplete'}</title></rect>}{row.maintenance!=null&&<rect x={x(index)+1} y={energyY(row.maintenance)} width={bar} height={185-energyY(row.maintenance)} className="energy-maintenance"><title>{row.date} to {row.end}: {displayEnergy(row.maintenance,units.energy)} {energyUnit} estimated maintenance</title></rect>}{tick(index)&&<text x={x(index)} y="211" textAnchor="middle">{row.date}</text>}</g>)}
      </svg><p className="chart-key">Accent: intake · Muted: maintenance · Faded: incomplete · {energyUnit}</p>
      <h3>Surplus or deficit</h3><svg viewBox={`0 0 ${chart.width} 225`} className="weight-chart" role="img" aria-label={`Signed energy balance by ${grouping}. Positive values are surplus; negative values are deficit. Missing or incomplete groups have no balance bar.`}>
        <line x1={chart.left} x2={chart.right} y1="110" y2="110" className="chart-grid"/><text x={chart.left-8} y="49" textAnchor="end">+{displayEnergy(balanceMax,units.energy)}</text><text x={chart.left-8} y="114" textAnchor="end">0</text><text x={chart.left-8} y="179" textAnchor="end">−{displayEnergy(balanceMax,units.energy)}</text>
        {rows.map((row,index)=><g key={`${row.date}-${row.end}`}>{row.balance!=null?<rect x={x(index)-bar/2} y={Math.min(110,netY(row.balance))} width={bar} height={Math.max(1,Math.abs(netY(row.balance)-110))} className={row.balance>=0?'energy-surplus':'energy-deficit'}><title>{row.date} to {row.end}: {row.balance>0?'+':''}{displayEnergy(row.balance,units.energy)} {energyUnit}</title></rect>:<text x={x(index)} y="114" textAnchor="middle">?</text>}{tick(index)&&<text x={x(index)} y="211" textAnchor="middle">{row.date}</text>}</g>)}
      </svg><p className="chart-key">{complete.length?<>{complete.length} complete groups · <strong>{stats?.totalBalance!=null&&stats.totalBalance>0?'+':''}{displayEnergy(stats?.totalBalance,units.energy)} {energyUnit}</strong></>:'No complete days with an accepted maintenance estimate.'}</p>
    </>}
  </section>;
}

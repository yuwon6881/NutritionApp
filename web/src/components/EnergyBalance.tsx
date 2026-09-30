import {useId} from 'react';
import type {Nourish} from '../useNourish';
import type {ProgressPeriod,ProgressSummary} from '../types';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {bucketReadoutLabel,dateSpan} from '../lib/chartLabels';
import {CardFeedback} from './ui/CardFeedback';
import {useChartScrub} from './ui/useChartScrub';
import {useBarViewport,useRevealBar} from './ui/useBarViewport';
import {BarChartNav} from './ui/BarChartFrame';
import {BalanceChart,IntakeChart} from './EnergyBalanceCharts';

const groupingNoun={daily:'days',weekly:'weeks',monthly:'months'} as const;
const groupingSingular={daily:'day',weekly:'week',monthly:'month'} as const;

export function EnergyBalance({store,period,summary,error}:{store:Nourish;period:ProgressPeriod;summary?:ProgressSummary;error?:string}){
  const state=store.state!;
  const units=unitsFor(state.settings);
  const energyUnit=energyLabel(units.energy);
  const rows=summary?.energy.series??[];
  const grouping=summary?.grouping.energy??'daily';
  const stats=summary?.energy.statistics;
  const viewport=useBarViewport(rows.length);
  const scrub=useChartScrub(rows.map((_,index)=>viewport.slot*(index+.5)),{tapToSelect:true});
  useRevealBar(viewport,scrub.index);
  const selected=rows[scrub.index];
  const readoutId=useId();
  const amount=(value:number)=>`${displayEnergy(value,units.energy)} ${energyUnit}`;
  const balanceText=(value:number|null)=>value==null?'Not known':value===0?'Even':`${value>0?'Surplus +':'Deficit −'}${amount(Math.abs(value))}`;
  const visibleSpan=rows.length?dateSpan(rows[viewport.edges.first]?.date??rows[0].date,rows[viewport.edges.last]?.end??rows.at(-1)!.end):'';
  const chartProps={rows,grouping,energyUnit:units.energy,viewport,selected:scrub.index,plotProps:scrub.svgProps};
  return <section className="panel energy-history">
    <div className="section-heading"><div><h2>Energy balance</h2><p>{summary?dateSpan(summary.start,summary.end):'Loading…'}</p></div></div>
    {error&&<CardFeedback
      title={summary?'Energy summary needs attention':'Energy summary unavailable'}
      message={`${summary?'Showing saved data.':'Not available offline.'} ${error}`}
      action={{label:'Retry',onClick:()=>void store.refreshProgress(period)}}
    />}
    {!summary&&!error&&<div className="skeleton" aria-busy="true" style={{minHeight:320}}/>}
    {summary&&<>
      {summary.awaitingSynchronization&&<p className="notice" role="status">Recent edits will update after sync.</p>}
      <div className="stats-grid progress-energy-stats">
        <section><p className="eyebrow">COMPLETE DAYS</p><h3>{stats?.completeDays??0}</h3><p>of {stats?.days??0}</p></section>
        <section><p className="eyebrow">AVERAGE INTAKE</p><h3>{displayEnergy(stats?.averageIntake,units.energy)} <span className="unit">{energyUnit}</span></h3><p>{stats?.loggedDays??0} logged</p></section>
        <section><p className="eyebrow">TOTAL BALANCE</p><h3>{stats?.totalBalance==null?'—':`${stats.totalBalance>0?'+':''}${displayEnergy(stats.totalBalance,units.energy)}`} <span className="unit">{energyUnit}</span></h3><p>{stats?.surplusDays??0} surplus · {stats?.deficitDays??0} deficit</p></section>
      </div>
      {rows.length?<div className="chart-scrub energy-charts" role="group" aria-label={`Energy charts. Tap a bar or use the left and right arrow keys to read a ${groupingSingular[grouping]}.`} aria-describedby={readoutId} {...scrub.groupProps}>
        <div id={readoutId} className="chart-readout chart-readout-grid" aria-live="polite">
          <strong className="chart-readout-date">{selected?bucketReadoutLabel(selected.date,selected.end,grouping):'—'}</strong>
          <dl>
            <div><dt>Intake</dt><dd>{selected?.intake==null?'Not logged':<>{amount(selected.intake)}{selected.complete?'':<small> partly logged</small>}</>}</dd></div>
            <div><dt>Maintenance</dt><dd>{selected?.maintenance==null?'No estimate':amount(selected.maintenance)}</dd></div>
            <div><dt>Balance</dt><dd className={selected?.balance==null?'':selected.balance>0?'is-surplus':selected.balance<0?'is-deficit':''}>{balanceText(selected?.balance??null)}</dd></div>
          </dl>
        </div>
        <BarChartNav viewport={viewport} range={visibleSpan}/>
        <div className="chart-block">
          <h3>Intake and maintenance</h3>
          <p className="sr-only">Bars are the calories you logged. The line is your estimated maintenance: roughly what keeps your weight steady.</p>
          <IntakeChart {...chartProps}/>
          <ul className="chart-legend" aria-label="Intake chart key">
            <li><span className="legend-swatch swatch-intake" aria-hidden="true"/>Logged intake</li>
            <li><span className="legend-swatch swatch-partial" aria-hidden="true"/>Partly logged</li>
            <li><span className="legend-line swatch-maintenance" aria-hidden="true"/>Maintenance</li>
            <li><span className="legend-swatch swatch-missing" aria-hidden="true"/>Nothing logged</li>
          </ul>
        </div>
        <div className="chart-block">
          <h3>Surplus or deficit</h3>
          <p className="sr-only">Logged intake minus estimated maintenance. Above zero you ate more than you burned; below zero, less. Only fully logged {groupingNoun[grouping]} with an estimate get a bar.</p>
          {!rows.some(row=>row.balance!=null)&&<p className="notice chart-empty-note">No complete days to compare.</p>}
          <BalanceChart {...chartProps}/>
          <ul className="chart-legend" aria-label="Surplus or deficit chart key">
            <li><span className="legend-swatch swatch-surplus" aria-hidden="true"/>Surplus</li>
            <li><span className="legend-swatch swatch-deficit" aria-hidden="true"/>Deficit</li>
            <li><span className="legend-swatch swatch-missing" aria-hidden="true"/>Not known</li>
          </ul>
        </div>
      </div>:<div className="empty"><h3>No energy data in this period</h3></div>}
    </>}
  </section>;
}

import {useId,useState} from 'react';
import type {NutritionStore} from '../useNutritionStore';
import type {ProgressPeriod,ProgressSummary} from '../types';
import {unitsFor} from '../lib/units';
import {dateSpan} from '../lib/chartLabels';
import {CardFeedback} from './ui/CardFeedback';
import {SegmentedControl} from './ui/SegmentedControl';
import {useChartScrub} from './ui/useChartScrub';
import {useBarViewport,useRevealBar} from './ui/useBarViewport';
import {BarChartNav} from './ui/BarChartFrame';
import {BalanceChart,IntakeChart} from './EnergyBalanceCharts';
import {EnergyReadout,type EnergyView} from './EnergyReadout';
import {EnergyStats} from './EnergyStats';

const groupingNoun={daily:'days',weekly:'weeks',monthly:'months'} as const;
const groupingSingular={daily:'day',weekly:'week',monthly:'month'} as const;

export function EnergyBalance({store,period,summary,error}:{store:NutritionStore;period:ProgressPeriod;summary?:ProgressSummary;error?:string}){
  const state=store.state!;
  const units=unitsFor(state.settings);
  const rows=summary?.energy.series??[];
  const grouping=summary?.grouping.energy??'daily';
  const stats=summary?.energy.statistics;
  const viewport=useBarViewport(rows.length);
  const scrub=useChartScrub(rows.map((_,index)=>viewport.slot*(index+.5)),{tapToSelect:true});
  useRevealBar(viewport,scrub.index);
  const selected=rows[scrub.index];
  const readoutId=useId();
  const [view,setView]=useState<EnergyView>('intake');
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
      <EnergyStats stats={stats} energyUnit={units.energy}/>
      {rows.length?<div className="chart-scrub energy-charts" role="group" aria-label={`Energy charts. Tap a bar or use the left and right arrow keys to read a ${groupingSingular[grouping]}.`} aria-describedby={readoutId} {...scrub.groupProps}>
        <div className="section-heading chart-heading">
          <div><h3>{view==='intake'?'Intake and maintenance':'Surplus or deficit'}</h3></div>
          <SegmentedControl<EnergyView> layout="equal" className="chart-view-toggle" label="Energy chart display" value={view} onChange={setView} options={[
            {value:'intake',label:<><span className="tab-label-full">Intake and maintenance</span><span className="tab-label-short">Intake</span></>,ariaLabel:'Intake and maintenance'},
            {value:'balance',label:<><span className="tab-label-full">Surplus or deficit</span><span className="tab-label-short">Balance</span></>,ariaLabel:'Surplus or deficit'}
          ]}/>
        </div>
        <EnergyReadout id={readoutId} row={selected} grouping={grouping} energyUnit={units.energy} view={view}/>
        <BarChartNav viewport={viewport} range={visibleSpan}/>
        {view==='intake'?<div className="chart-block">
          <p className="sr-only">Bars are the calories you logged. The line is your estimated maintenance: roughly what keeps your weight steady.</p>
          <IntakeChart {...chartProps}/>
          <ul className="chart-legend" aria-label="Intake chart key">
            <li><span className="legend-swatch swatch-intake" aria-hidden="true"/>Logged intake</li>
            <li><span className="legend-swatch swatch-partial" aria-hidden="true"/>Partly logged</li>
            <li><span className="legend-line swatch-maintenance" aria-hidden="true"/>Maintenance</li>
            <li><span className="legend-swatch swatch-missing" aria-hidden="true"/>Nothing logged</li>
          </ul>
        </div>:<div className="chart-block">
          <p className="sr-only">Logged intake minus estimated maintenance. Above zero you ate more than you burned; below zero, less. Only fully logged {groupingNoun[grouping]} with an estimate get a bar.</p>
          {!rows.some(row=>row.balance!=null)&&<p className="notice chart-empty-note">No complete days to compare.</p>}
          <BalanceChart {...chartProps}/>
          <ul className="chart-legend" aria-label="Surplus or deficit chart key">
            <li><span className="legend-swatch swatch-surplus" aria-hidden="true"/>Surplus</li>
            <li><span className="legend-swatch swatch-deficit" aria-hidden="true"/>Deficit</li>
            <li><span className="legend-swatch swatch-missing" aria-hidden="true"/>Not known</li>
          </ul>
        </div>}
      </div>:<div className="empty"><h3>No energy data in this period</h3></div>}
    </>}
  </section>;
}

import {useMemo,useState} from 'react';
import {CloudDownload,Pencil,Trash2} from 'lucide-react';
import type {ProgressSummary,Weight} from '../types';
import {displayWeight,weightLabel,type unitsFor} from '../lib/units';
import {monthShort,readoutDate,weekdayShort} from '../lib/format';
import {dateSpan} from '../lib/chartLabels';
import {changeSincePrevious} from '../lib/weighInList';
import {weightContextLabel} from '../lib/weightContext';
import {Button} from './ui/Button';
import {WeightChart} from './WeightChart';

type Units=ReturnType<typeof unitsFor>;

// A week of rows keeps the list short on a phone; the rest are one tap away.
const INITIAL_ROWS=7;

export function WeightSummary({summary,units,pending,onEdit,onDelete,pendingDeletes}:{summary:ProgressSummary;units:Units;pending:boolean;onEdit:(weight:Weight,trigger:HTMLElement)=>void;onDelete:(weight:Weight,trigger:HTMLElement)=>void;pendingDeletes:ReadonlySet<string>}){
  const stats=summary.weight.statistics;
  const isTrendPending=Boolean(stats.trendPending);
  const unit=weightLabel(units.weight);
  const editable=useMemo(()=>summary.weight.editableWeighIns.filter(weight=>!pendingDeletes.has(weight.id)),[summary.weight.editableWeighIns,pendingDeletes]);
  const trendChange=stats.trendChangeKg;
  const [showAll,setShowAll]=useState(false);
  const shown=useMemo(()=>showAll?editable:editable.slice(0,INITIAL_ROWS),[editable,showAll]);
  return <>
    {pending&&<p className="notice" role="status">Recent edits will update after sync.</p>}
    <div className="stats-grid">
      <section className="panel"><p className="eyebrow">TREND WEIGHT</p><h2>{isTrendPending?'—':displayWeight(stats.latestTrendKg,units.weight,1)} <span className="unit">{unit}</span></h2>{isTrendPending&&<p>Pending sync</p>}</section>
      <section className="panel"><p className="eyebrow">AVERAGE SCALE WEIGHT</p><h2>{displayWeight(stats.averageKg,units.weight,1)} <span className="unit">{unit}</span></h2><p>{stats.count} {stats.count===1?'weigh-in':'weigh-ins'}</p></section>
      <section className="panel"><p className="eyebrow">CHANGE IN TREND</p><h2>{isTrendPending||trendChange==null?'—':`${trendChange>0?'+':trendChange<0?'−':''}${displayWeight(Math.abs(trendChange),units.weight,1)}`} <span className="unit">{unit}</span></h2><p>{isTrendPending?'Pending sync':dateSpan(summary.start,summary.end)}</p></section>
    </div>
    <WeightChart series={summary.weight.series} weightUnit={units.weight} periodStart={summary.start} periodEnd={summary.end}/>
    <section className="panel weight-history-panel" aria-labelledby="latest-weigh-ins-title">
      <div className="section-heading"><div><h2 id="latest-weigh-ins-title">Latest weigh-ins</h2></div></div>
      {editable.length?<><ul className="weigh-in-list">{shown.map(weight=>{
        const change=changeSincePrevious(summary.weight.series,weight.date,weight.kg);
        const context=weightContextLabel(weight.context);
        const spoken=readoutDate(weight.date);
        return <li className="weigh-in-row" key={weight.id}>
          <time className="weigh-in-date" dateTime={weight.date}>
            <span className="weigh-in-month">{monthShort(weight.date)}</span>
            <strong className="weigh-in-day">{Number(weight.date.slice(8,10))}</strong>
            <span className="weigh-in-weekday">{weekdayShort(weight.date)}</span>
          </time>
          <div className="weigh-in-value">
            <p className="weigh-in-kg">
              <span className="figure">{displayWeight(weight.kg,units.weight,2)}</span> <span className="unit">{unit}</span>
              {/* The source rides beside the value as an icon so every row keeps the same one-line change text. */}
              {weight.source==='google_health'&&<span className="weigh-in-source" title="From Google Health"><CloudDownload size={13} aria-hidden="true"/><span className="sr-only">, from Google Health</span></span>}
            </p>
            <p className="weigh-in-meta">
              {change==null?'First in period':Math.abs(change)<.005?'No change':<>{`${change>0?'+':'−'}${displayWeight(Math.abs(change),units.weight,2)} ${unit}`}<span className="sr-only"> from the previous weigh-in</span></>}
              {context&&<span className="weigh-in-context"> · {context}</span>}
            </p>
          </div>
          <div className="weigh-in-actions">
            <Button variant="tertiary" size="icon" aria-label={`Edit weigh-in from ${spoken}`} onClick={event=>onEdit(weight,event.currentTarget)}><Pencil size={17} aria-hidden="true"/></Button>
            <Button variant="tertiary" size="icon" className="weigh-in-delete" aria-label={`Delete weigh-in from ${spoken}`} onClick={event=>onDelete(weight,event.currentTarget)}><Trash2 size={17} aria-hidden="true"/></Button>
          </div>
        </li>;
      })}</ul>
      {editable.length>INITIAL_ROWS&&<div className="weigh-in-more"><Button variant="secondary" aria-expanded={showAll} onClick={()=>setShowAll(value=>!value)}>{showAll?'Show fewer':`Show ${editable.length-INITIAL_ROWS} more`}</Button></div>}</>
      :<p className="empty">No weigh-ins in this period.</p>}
    </section>
  </>;
}

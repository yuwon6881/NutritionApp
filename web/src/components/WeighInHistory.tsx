import {useEffect,useMemo,useRef,useState} from 'react';
import {CloudDownload,MoreHorizontal,Pencil,Scale,Trash2} from 'lucide-react';
import type {ProgressSummary,Weight} from '../types';
import {displayWeight,weightLabel,type unitsFor} from '../lib/units';
import {monthShort,readoutDate,weekdayShort} from '../lib/format';
import {changeSincePrevious,mergeWeighInRows} from '../lib/weighInList';
import {weightContextLabel} from '../lib/weightContext';
import {Button} from './ui/Button';
import {EmptyState} from './ui/EmptyState';
import {ActionSheet,type ActionSheetOption} from './ui/ActionSheet';
import {CardFeedback} from './ui/CardFeedback';
import {SkeletonBlock} from './ui/Skeleton';
import {useWeighInHistory} from './useWeighInHistory';

type Units=ReturnType<typeof unitsFor>;

// A week of rows keeps the list short on a phone; older rows page in as the person scrolls on.
const INITIAL_ROWS=7;

/** The weigh-ins of the selected period, newest first, with edit and delete actions. */
export function WeighInHistory({summary,units,onEdit,onDelete,pendingDeletes}:{summary:ProgressSummary;units:Units;onEdit:(weight:Weight,trigger:HTMLElement)=>void;onDelete:(weight:Weight,trigger:HTMLElement)=>void;pendingDeletes:ReadonlySet<string>}){
  const stats=summary.weight.statistics;
  const unit=weightLabel(units.weight);
  const history=useWeighInHistory(summary.start,summary.end,summary.revision);
  const editable=useMemo(()=>mergeWeighInRows(summary.weight.editableWeighIns,history.items,pendingDeletes),[summary.weight.editableWeighIns,history.items,pendingDeletes]);
  const [showAll,setShowAll]=useState(false);
  // The period's weigh-in count says whether older rows exist before any page has been read.
  const canLoad=history.hasMore&&editable.length<stats.count;
  const hasHidden=showAll?canLoad:editable.length>INITIAL_ROWS||canLoad;
  useEffect(()=>setShowAll(false),[summary.start,summary.end]);
  const loadMore=history.loadMore;
  const showMore=()=>{
    if(!showAll){setShowAll(true);if(editable.length<INITIAL_ROWS*2&&canLoad)loadMore();return;}
    if(canLoad)loadMore();
  };
  // Once the list is open, reaching its end reads the next page without another tap.
  const moreRef=useRef<HTMLDivElement>(null);
  const autoLoad=showAll&&canLoad&&!history.loading&&!history.error;
  useEffect(()=>{
    const element=moreRef.current;
    if(!autoLoad||!element||typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))loadMore();},{rootMargin:'320px 0px'});
    observer.observe(element);
    return()=>observer.disconnect();
  },[autoLoad,loadMore]);
  const [menuTarget,setMenuTarget]=useState<{weight:Weight;trigger:HTMLElement}|null>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  const shown=useMemo(()=>showAll?editable:editable.slice(0,INITIAL_ROWS),[editable,showAll]);
  const menuOptions:ActionSheetOption[]=useMemo(()=>menuTarget?[
    {id:'edit',label:'Edit weigh-in',icon:<Pencil size={20} aria-hidden="true"/>,onClick:()=>onEdit(menuTarget.weight,menuTarget.trigger)},
    {id:'delete',label:'Delete weigh-in',icon:<Trash2 size={20} aria-hidden="true"/>,variant:'destructive',onClick:()=>onDelete(menuTarget.weight,menuTarget.trigger)},
  ]:[],[menuTarget,onEdit,onDelete]);
  return <>
    <section id="dashboard-weight-history" className="weight-history-panel" aria-labelledby="latest-weigh-ins-title">
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
              <span className="figure">{displayWeight(weight.kg,units.weight,1)}</span> <span className="unit">{unit}</span>
              {/* The source rides beside the value as an icon so every row keeps the same one-line change text. */}
              {weight.source==='google_health'&&<span className="weigh-in-source" title="From Google Health"><CloudDownload size={13} aria-hidden="true"/><span className="sr-only">, from Google Health</span></span>}
            </p>
            <p className="weigh-in-meta">
              {change==null?'First in period':displayWeight(Math.abs(change),units.weight,1)==='0'?'No change':<>{`${change>0?'+':'−'}${displayWeight(Math.abs(change),units.weight,1)} ${unit}`}<span className="sr-only"> from the previous weigh-in</span></>}
              {context&&<span className="weigh-in-context"> · {context}</span>}
            </p>
          </div>
          <div className="weigh-in-actions">
            <Button variant="tertiary" size="icon" aria-label={`More actions for weigh-in from ${spoken}`} onClick={event=>{setMenuTarget({weight,trigger:event.currentTarget});setMenuOpen(true);}}><MoreHorizontal size={17} aria-hidden="true"/></Button>
          </div>
        </li>;
      })}</ul>
      {showAll&&history.loading&&<div className="weigh-in-loading" role="status" aria-busy="true"><span className="sr-only">Loading older weigh-ins</span>
        {[0,1].map(index=><div key={index} className="weigh-in-row" aria-hidden="true"><SkeletonBlock width={54} height={58} radius={10}/><div><SkeletonBlock width={88} height={18}/><SkeletonBlock width={120} height={12} className="weigh-in-skeleton-meta"/></div></div>)}
      </div>}
      {showAll&&history.error&&<CardFeedback title="Older weigh-ins unavailable" message={history.error} action={{label:'Retry',onClick:loadMore,disabled:history.loading}}/>}
      {(hasHidden||showAll)&&editable.length>INITIAL_ROWS-1&&<div className="weigh-in-more" ref={moreRef}>
        <p className="weigh-in-count">Showing {shown.length} of {Math.max(stats.count,editable.length)}</p>
        {hasHidden?<Button variant="secondary" aria-expanded={showAll} disabled={history.loading} onClick={showMore}>Show more</Button>
          :<Button variant="secondary" aria-expanded={showAll} onClick={()=>setShowAll(false)}>Show fewer</Button>}
      </div>}</>
      :<EmptyState icon={Scale} title="No weigh-ins in this period" description="Pick a longer period, or log a weigh-in to see it here."/>}
    </section>
    <ActionSheet isOpen={menuOpen} onClose={()=>setMenuOpen(false)} restoreFocus={menuTarget?.trigger} title="Weigh-in" subtitle={menuTarget?readoutDate(menuTarget.weight.date):undefined} options={menuOptions}/>
  </>;
}

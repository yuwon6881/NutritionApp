import {useId,useMemo,type CSSProperties} from 'react';
import {ArrowDown,ArrowRight,ArrowUp,ChevronRight} from 'lucide-react';
import type {Weight,WeightUnit} from '../../types';
import type {ProgressFocus} from '../Progress';
import {readoutDate,shortDate} from '../../lib/format';
import {displayWeight,weightLabel} from '../../lib/units';
import {sparklinePaths,trendInsight,type TrendPoint} from '../../lib/trendInsight';
import {Button} from '../ui/Button';
import './dashboard.css';

const SPARK_WIDTH=300,SPARK_HEIGHT=64;

function signed(kg:number,unit:WeightUnit){
  const shown=displayWeight(Math.abs(kg),unit,1);
  if(shown==='0')return 'No change';
  return `${kg>0?'+':'−'}${shown} ${weightLabel(unit)}`;
}

/** Whether a change reads as up, down, or flat once rounded for display. */
function direction(kg:number,unit:WeightUnit):'up'|'down'|'flat'{
  if(displayWeight(Math.abs(kg),unit,1)==='0')return 'flat';
  return kg>0?'up':'down';
}

const directionIcon={up:ArrowUp,down:ArrowDown,flat:ArrowRight};

/**
 * The Dashboard's trend weight, after MacroFactor's weight-trend insight: the latest
 * trend with its change over about a week and a thirty-day trend line, which open the
 * Progress chart, then the latest scale weigh-ins, which open the weigh-in history. The
 * content itself is the way in; there is no separate action strip. Whether a change is
 * good depends on the goal, so it stays neutral.
 */
export function WeightTrendCard({points,recent,current,unit,onOpen}:{points:readonly TrendPoint[];recent:readonly Weight[];current:string;unit:WeightUnit;onOpen:(focus:ProgressFocus)=>void}){
  const insight=useMemo(()=>trendInsight(points),[points]);
  const gradient=useId();
  const paths=insight?sparklinePaths(insight.recent,SPARK_WIDTH,SPARK_HEIGHT):null;
  const isToday=insight?.latest.date===current;
  const asOf=insight?(isToday?'today':shortDate(insight.latest.date)):'';
  const change=insight?.change??null;
  const changeDirection=change?direction(change.kg,unit):null;
  const ChangeIcon=changeDirection?directionIcon[changeDirection]:null;
  const changeText=change?`${signed(change.kg,unit)} since ${shortDate(change.since)}`:'';
  const label=insight
    ?`Trend weight: ${displayWeight(insight.latest.kg,unit,1)} ${weightLabel(unit)} as of ${asOf}${changeText?`, ${changeText}`:''}. Open weight chart`
    :'Trend weight: no weigh-in yet. Open weight chart';
  const unitText=weightLabel(unit);
  const recentLabel=`Latest weigh-ins: ${recent.map(weight=>`${readoutDate(weight.date)} ${displayWeight(weight.kg,unit,2)} ${unitText}`).join(', ')}. Open weigh-in history`;
  return <article className="panel dashboard-trend-panel">
    <Button presentation="plain" className="dashboard-trend-summary" aria-label={label} onClick={()=>onOpen('chart')}>
      <span className="dashboard-trend-head">
        <span className="eyebrow">Trend weight</span>
        <span className="dashboard-trend-asof">{insight&&<>As of {asOf}</>}<ChevronRight size={16} className="dashboard-trend-chevron" aria-hidden="true"/></span>
      </span>
      <span className="dashboard-trend-figure">
        <span className="dashboard-trend-value"><strong>{insight?displayWeight(insight.latest.kg,unit,1):'—'}</strong> <span className="unit">{weightLabel(unit)}</span></span>
        {change&&ChangeIcon&&<span className="dashboard-trend-change" data-direction={changeDirection}>
          <ChangeIcon size={15} aria-hidden="true"/>{changeText}
        </span>}
      </span>
      {paths&&insight
        ?<span className="dashboard-trend-plot">
          <span className="dashboard-trend-canvas" style={{'--end-x':`${paths.end.x/SPARK_WIDTH*100}%`,'--end-y':`${paths.end.y/SPARK_HEIGHT*100}%`} as CSSProperties}>
            <svg className="dashboard-sparkline" viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
              <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="sparkline-stop-top"/><stop offset="1" className="sparkline-stop-bottom"/></linearGradient></defs>
              <path className="sparkline-area" d={paths.area} fill={`url(#${gradient})`}/>
              <path className="sparkline-line" d={paths.line} vectorEffect="non-scaling-stroke"/>
            </svg>
            {/* Drawn in HTML so the stretched SVG cannot squash it into an oval. */}
            <span className="dashboard-trend-marker" aria-hidden="true"/>
          </span>
          <span className="dashboard-trend-axis" aria-hidden="true">
            <span>{shortDate(insight.recent[0].date)}</span>
            <span>{isToday?'Today':asOf}</span>
          </span>
        </span>
        :<small className="dashboard-trend-empty">{insight?'The trend line appears after another weigh-in.':'Log a weigh-in to start your trend.'}</small>}
    </Button>
    {recent.length>0&&<Button presentation="plain" className="dashboard-trend-recent" aria-label={recentLabel} onClick={()=>onOpen('history')}>
      <span className="dashboard-trend-recent-list">
        {recent.map(weight=><span className="dashboard-trend-recent-item" key={weight.id}>
          <span className="dashboard-trend-recent-date">{weight.date===current?'Today':shortDate(weight.date)}</span>
          <span className="dashboard-trend-recent-value"><strong>{displayWeight(weight.kg,unit,2)}</strong> <span className="unit">{unitText}</span></span>
        </span>)}
      </span>
      <ChevronRight size={16} className="dashboard-trend-chevron" aria-hidden="true"/>
    </Button>}
  </article>;
}

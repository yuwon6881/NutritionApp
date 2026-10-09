import {useId,useMemo} from 'react';
import {ChevronRight} from 'lucide-react';
import type {WeightUnit} from '../../types';
import {shortDate} from '../../lib/format';
import {displayWeight,weightLabel} from '../../lib/units';
import {sparklinePaths,trendInsight,type TrendPoint} from '../../lib/trendInsight';
import {Button} from '../ui/Button';
import './dashboard.css';

const SPARK_WIDTH=120,SPARK_HEIGHT=40;

function signed(kg:number,unit:WeightUnit){
  const shown=displayWeight(Math.abs(kg),unit,1);
  if(shown==='0')return 'No change';
  return `${kg>0?'+':'−'}${shown} ${weightLabel(unit)}`;
}

/**
 * The Dashboard's trend weight with its change over about a week and a thirty-day
 * sparkline, after MacroFactor's weight-trend insight. The whole card opens Progress.
 */
export function WeightTrendCard({points,current,unit,onOpen}:{points:readonly TrendPoint[];current:string;unit:WeightUnit;onOpen:()=>void}){
  const insight=useMemo(()=>trendInsight(points),[points]);
  const gradient=useId();
  const paths=insight?sparklinePaths(insight.recent,SPARK_WIDTH,SPARK_HEIGHT):null;
  const when=insight?(insight.latest.date===current?'today':shortDate(insight.latest.date)):'';
  const change=insight?.change?`${signed(insight.change.kg,unit)} since ${shortDate(insight.change.since)}`:'';
  const label=insight
    ?`Trend weight: ${displayWeight(insight.latest.kg,unit,1)} ${weightLabel(unit)} as of ${when}${change?`, ${change}`:''}. Open Progress`
    :'Trend weight: no weigh-in yet. Open Progress';
  return <article className="panel dashboard-trend-panel">
    <Button presentation="plain" className="dashboard-insight-trigger" aria-label={label} onClick={onOpen}>
      <span className="dashboard-insight-text">
        <span className="eyebrow">TREND WEIGHT</span>
        <span className="dashboard-insight-value">
          <strong>{insight?displayWeight(insight.latest.kg,unit,1):'—'}</strong> <span className="unit">{weightLabel(unit)}</span>
        </span>
        {change&&<span className="dashboard-insight-change" data-direction={insight!.change!.kg<0?'down':insight!.change!.kg>0?'up':undefined}>{change}</span>}
        <small>{insight?`As of ${when}`:'No weigh-in yet'}</small>
      </span>
      {paths&&<svg className="dashboard-sparkline" viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="sparkline-stop-top"/><stop offset="1" className="sparkline-stop-bottom"/></linearGradient></defs>
        <path className="sparkline-area" d={paths.area} fill={`url(#${gradient})`}/>
        <path className="sparkline-line" d={paths.line} vectorEffect="non-scaling-stroke"/>
      </svg>}
      <ChevronRight size={18} className="dashboard-insight-chevron" aria-hidden="true"/>
    </Button>
  </article>;
}

import {shiftIsoDate} from './loggingCalendar';

export interface TrendPoint {date:string;kg:number}

export interface TrendInsight {
  latest:TrendPoint;
  /** Change since the last trend point at least a week earlier; null without one in the past fortnight. */
  change:{kg:number;since:string}|null;
  /** Trend points of the last thirty days for the sparkline, oldest first. */
  recent:TrendPoint[];
}

/** The Dashboard's weight trend summary from cleaned trend points (oldest first). */
export function trendInsight(points:readonly TrendPoint[]):TrendInsight|null{
  const latest=points.at(-1);
  if(!latest)return null;
  const weekBefore=shiftIsoDate(latest.date,-7);
  const fortnightBefore=shiftIsoDate(latest.date,-14);
  const reference=[...points].reverse().find(point=>point.date<=weekBefore);
  const change=reference&&reference.date>=fortnightBefore?{kg:latest.kg-reference.kg,since:reference.date}:null;
  const monthBefore=shiftIsoDate(latest.date,-30);
  return {latest,change,recent:points.filter(point=>point.date>=monthBefore)};
}

/**
 * Line and closed-area paths for a small sparkline inside a width × height box with
 * `pad` units of headroom. Dates set x (real spacing, not index); a flat series sits mid-height.
 */
export function sparklinePaths(points:readonly TrendPoint[],width:number,height:number,pad=3):{line:string;area:string}|null{
  if(points.length<2)return null;
  const times=points.map(point=>Date.parse(`${point.date}T00:00:00Z`));
  const first=times[0],span=times.at(-1)!-first||1;
  const values=points.map(point=>point.kg);
  const low=Math.min(...values),range=Math.max(...values)-low;
  const xy=points.map((point,index)=>{
    const x=(times[index]-first)/span*width;
    const y=range?pad+(1-(point.kg-low)/range)*(height-pad*2):height/2;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line=`M${xy.join(' L')}`;
  return {line,area:`${line} L${width} ${height} L0 ${height} Z`};
}

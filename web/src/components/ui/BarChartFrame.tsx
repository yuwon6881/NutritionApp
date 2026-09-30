import type {ReactNode} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {Button} from './Button';
import type {BarViewport} from './useBarViewport';

/** Width of the fixed value axis beside a scrolling plot. */
export const BAR_AXIS_WIDTH=52;

/**
 * A value axis that stays put beside a horizontally scrolling plot. The plot is
 * `contentWidth` wide in its own coordinates, so bars keep a readable width on
 * every screen and the period is explored by scrolling instead of squeezing.
 */
export function BarChartFrame({viewport,height,axis,label,plotProps,children}:{
  viewport:BarViewport;
  height:number;
  axis:ReactNode;
  label:string;
  plotProps?:React.SVGProps<SVGSVGElement>;
  children:ReactNode;
}){
  const {edges,contentWidth,scrollerProps}=viewport;
  return <div className="bar-chart-frame">
    <svg className="bar-chart-axis" width={BAR_AXIS_WIDTH} height={height} viewBox={`0 0 ${BAR_AXIS_WIDTH} ${height}`} aria-hidden="true">{axis}</svg>
    <div className={`bar-chart-scroller${edges.back?' can-back':''}${edges.forward?' can-forward':''}`} {...scrollerProps}>
      {contentWidth>0&&<svg className="bar-chart-plot" width={contentWidth} height={height} viewBox={`0 0 ${contentWidth} ${height}`} role="img" aria-label={label} {...plotProps}>{children}</svg>}
    </div>
  </div>;
}

/**
 * The dates currently in view, with earlier/later page buttons on medium and
 * expanded windows. Compact windows scroll by finger, so the buttons are hidden
 * there but the visible range stays readable.
 */
export function BarChartNav({viewport,range,noun}:{viewport:BarViewport;range:string;noun:string}){
  const {edges,scrollable,scrollPage}=viewport;
  return <div className="bar-chart-nav">
    {scrollable&&<Button variant="tertiary" size="icon" className="bar-chart-page" aria-label={`Show earlier ${noun}`} disabled={!edges.back} onClick={()=>scrollPage(-1)}><ChevronLeft size={18} aria-hidden="true"/></Button>}
    <p className="bar-chart-range">{range}{scrollable&&<span className="bar-chart-hint"> · swipe for more</span>}</p>
    {scrollable&&<Button variant="tertiary" size="icon" className="bar-chart-page" aria-label={`Show later ${noun}`} disabled={!edges.forward} onClick={()=>scrollPage(1)}><ChevronRight size={18} aria-hidden="true"/></Button>}
  </div>;
}

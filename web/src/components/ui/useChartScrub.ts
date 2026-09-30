import {useEffect,useRef,useState} from 'react';
import {nearestIndex,steppedIndex} from '../../lib/chartScrub';
import {useFrameTask} from './useFrameTask';
import {useGestureRect} from './useGestureRect';

/**
 * Touch-first chart inspection. A finger (or mouse) moving over the chart
 * selects the nearest point; arrow keys step through points when the chart
 * group has focus. The selection starts at the latest point, so the readout
 * always states a real value instead of relying on hover tooltips, which
 * never appear on touch screens. Vertical page scrolling stays available
 * because the chart only claims horizontal movement (`touch-action: pan-y`).
 *
 * A chart inside a horizontal scroller passes `tapToSelect`: the finger then
 * scrolls the bars, and only a tap (a touch the browser did not take over for
 * scrolling) selects one. The mouse still follows the pointer.
 */
export function useChartScrub(positions:readonly number[],{tapToSelect=false}:{tapToSelect?:boolean}={}){
  const count=positions.length;
  const [index,setIndex]=useState(Math.max(0,count-1));
  const target=useRef<SVGSVGElement|null>(null);
  const geometry=useGestureRect(target);
  const selection=useFrameTask((x:number)=>{const next=nearestIndex(positions,x);if(next>=0)setIndex(next);});
  // A new series (period change, view change) starts again from its latest point.
  useEffect(()=>{setIndex(Math.max(0,count-1));},[count]);

  const pick=(event:React.PointerEvent<SVGSVGElement>)=>{
    const svg=event.currentTarget;
    if(target.current!==svg)geometry.invalidate();
    target.current=svg;
    const rect=geometry.read();
    if(!rect)return;
    const viewBoxWidth=svg.viewBox.baseVal?.width||rect.width;
    const x=(event.clientX-rect.left)*(viewBoxWidth/Math.max(1,rect.width));
    selection.schedule(x);
  };

  return {
    index:Math.min(index,Math.max(0,count-1)),
    svgProps:{
      onPointerDown:(event:React.PointerEvent<SVGSVGElement>)=>{
        geometry.invalidate();
        if(tapToSelect&&event.pointerType!=='mouse')return;
        pick(event);selection.flush();
      },
      onPointerMove:(event:React.PointerEvent<SVGSVGElement>)=>{
        // Mouse follows the pointer; touch and pen follow while pressed, unless the finger scrolls the bars.
        if(event.pointerType==='mouse'||event.buttons&&!tapToSelect)pick(event);
      },
      onPointerUp:(event:React.PointerEvent<SVGSVGElement>)=>{pick(event);selection.flush();},
      onPointerCancel:()=>{selection.cancel();geometry.invalidate();},
      onPointerLeave:()=>selection.flush(),
    },
    groupProps:{
      tabIndex:0,
      onKeyDown:(event:React.KeyboardEvent<HTMLElement>)=>{
        const next=steppedIndex(index,event.key,count);
        if(next===null)return;
        event.preventDefault();
        selection.cancel();
        setIndex(next);
      },
    },
  };
}

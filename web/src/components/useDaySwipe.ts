import {useCallback,useEffect,useLayoutEffect,useRef} from 'react';
import {dragDirection,lockAxis,startsOutsideEdge,swipeOutcome,swipeTranslate,type SwipeAxis} from '../lib/daySwipe';
import {hapticTick} from '../lib/haptics';
import {motionTiming,useReducedMotion} from './ui/Motion';
import {useFrameTask} from './ui/useFrameTask';

/** Cards own their sideways swipe; the strip, fields, and popups own their own touches. */
const OWN_TOUCH='[data-swipe-id],.food-week-strip,input,select,textarea,dialog,[role=dialog],[role=listbox],[role=slider]';
/** A committed swipe slides the day out this far (as a share of its width) before the next one slides in. */
const TRAVEL=.35;

interface Drag {
  pointerId:number;
  startX:number;
  startY:number;
  startTime:number;
  dx:number;
  axis:SwipeAxis;
}

/**
 * Touch swipe between days: dragging the day's content left opens the next day,
 * right the previous one. The content follows the finger, a committed swipe
 * slides it out and the new day in, and a short swipe settles back. Reduced
 * motion navigates without moving anything.
 */
export function useDaySwipe({enabled,date,canPrevious,canNext,onNavigate}:{
  enabled:boolean;
  date:string;
  canPrevious:boolean;
  canNext:boolean;
  onNavigate:(delta:-1|1)=>void;
}){
  const content=useRef<HTMLDivElement>(null);
  const drag=useRef<Drag|null>(null);
  const animation=useRef<Animation|null>(null);
  const entering=useRef<-1|0|1>(0);
  const recover=useRef<number|undefined>(undefined);
  const reduced=useReducedMotion();

  const clear=useCallback(()=>{
    animation.current?.cancel();animation.current=null;
    window.clearTimeout(recover.current);recover.current=undefined;
    content.current?.style.removeProperty('transform');
    content.current?.style.removeProperty('opacity');
  },[]);

  const follow=useFrameTask((dx:number)=>{
    const node=content.current;
    if(!node)return;
    const x=swipeTranslate(dx,canPrevious,canNext);
    node.style.transform=`translate3d(${x}px,0,0)`;
    node.style.opacity=String(1-Math.min(.45,Math.abs(x)/Math.max(1,node.offsetWidth)*.7));
  });

  const currentFrame=()=>{
    const node=content.current;
    return {transform:node?.style.transform||'translate3d(0,0,0)',opacity:node?.style.opacity||'1'};
  };

  const settle=useCallback(()=>{
    follow.cancel();
    const node=content.current;
    if(!node)return;
    if(reduced){clear();return;}
    const from=currentFrame();
    animation.current?.cancel();
    const settled=node.animate([from,{transform:'translate3d(0,0,0)',opacity:'1'}],{...motionTiming('--motion-exit',180),fill:'forwards'});
    animation.current=settled;
    settled.onfinish=()=>{if(animation.current===settled)clear();};
  },[clear,follow,reduced]);

  const commit=(direction:-1|1)=>{
    follow.cancel();
    hapticTick();
    const node=content.current;
    if(!node||reduced){clear();onNavigate(direction);return;}
    entering.current=direction;
    const from=currentFrame();
    animation.current?.cancel();
    const leaving=node.animate([from,{transform:`translate3d(${-direction*node.offsetWidth*TRAVEL}px,0,0)`,opacity:'0'}],{...motionTiming('--motion-exit',140),fill:'forwards'});
    animation.current=leaving;
    leaving.onfinish=()=>onNavigate(direction);
    // If the day could not change, bring the content back instead of leaving it hidden.
    recover.current=window.setTimeout(()=>{entering.current=0;clear();},1200);
  };

  // The new day slides in from the side the finger moved away from.
  useLayoutEffect(()=>{
    const direction=entering.current;
    const node=content.current;
    if(!direction||!node)return;
    entering.current=0;
    clear();
    if(reduced)return;
    const arriving=node.animate([{transform:`translate3d(${direction*node.offsetWidth*TRAVEL}px,0,0)`,opacity:0},{transform:'translate3d(0,0,0)',opacity:1}],motionTiming('--motion-panel',220));
    animation.current=arriving;
    arriving.onfinish=()=>{if(animation.current===arriving)clear();};
  },[date,clear,reduced]);

  useEffect(()=>{if(!enabled){drag.current=null;settle();}},[enabled,settle]);
  useEffect(()=>clear,[clear]);

  return {
    contentRef:content,
    bind:{
      onPointerDown:(event:React.PointerEvent<HTMLElement>)=>{
        if(!enabled||event.pointerType!=='touch'||!event.isPrimary||drag.current)return;
        const target=event.target as Element;
        // Portaled popups still bubble through React, so ignore touches that are not inside the page.
        if(!event.currentTarget.contains(target)||target.closest(OWN_TOUCH))return;
        if(!startsOutsideEdge(event.clientX,window.innerWidth))return;
        drag.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,startTime:event.timeStamp,dx:0,axis:'pending'};
      },
      onPointerMove:(event:React.PointerEvent<HTMLElement>)=>{
        const current=drag.current;
        if(!current||current.pointerId!==event.pointerId)return;
        const dx=event.clientX-current.startX;
        if(current.axis==='pending'){
          current.axis=lockAxis(dx,event.clientY-current.startY);
          if(current.axis==='vertical'){drag.current=null;return;}
          if(current.axis==='horizontal'){
            try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Capture only keeps the drag steady. */}
            // A swipe interrupting a settling animation takes over from where it stands.
            animation.current?.cancel();animation.current=null;
          }
        }
        if(current.axis!=='horizontal')return;
        current.dx=dx;
        follow.schedule(dx);
      },
      onPointerUp:(event:React.PointerEvent<HTMLElement>)=>{
        const current=drag.current;
        if(!current||current.pointerId!==event.pointerId)return;
        const horizontal=current.axis==='horizontal';
        const dx=event.clientX-current.startX;
        drag.current=null;
        if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
        if(!horizontal)return;
        const outcome=swipeOutcome(dx,event.timeStamp-current.startTime,canPrevious,canNext);
        if(outcome===0||dragDirection(dx)===0)settle();
        else commit(outcome);
      },
      onPointerCancel:(event:React.PointerEvent<HTMLElement>)=>{
        const current=drag.current;
        if(!current||current.pointerId!==event.pointerId)return;
        const horizontal=current.axis==='horizontal';
        drag.current=null;
        if(horizontal)settle();
      },
    }
  };
}

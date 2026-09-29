import {useRef,type PointerEvent} from 'react';

const MIN_DISTANCE=56;

/**
 * Horizontal swipe between records on a touch photo. The pointer type selects the gesture;
 * mouse users keep the buttons and arrow keys. Moving the finger right reveals the older
 * record, matching the left-to-right timeline of the navigator buttons.
 */
export function useRecordSwipe(onOlder:(()=>void)|undefined,onNewer:(()=>void)|undefined){
  const start=useRef<{id:number;x:number;y:number}|null>(null);
  return {
    onPointerDown:(event:PointerEvent<HTMLElement>)=>{
      if(event.pointerType==='mouse'||start.current)return;
      start.current={id:event.pointerId,x:event.clientX,y:event.clientY};
    },
    onPointerUp:(event:PointerEvent<HTMLElement>)=>{
      const origin=start.current;
      start.current=null;
      if(!origin||origin.id!==event.pointerId)return;
      const dx=event.clientX-origin.x,dy=event.clientY-origin.y;
      // Mostly-vertical movement is a page scroll, never a record change.
      if(Math.abs(dx)<MIN_DISTANCE||Math.abs(dx)<Math.abs(dy)*1.5)return;
      (dx>0?onOlder:onNewer)?.();
    },
    onPointerCancel:()=>{start.current=null;}
  };
}

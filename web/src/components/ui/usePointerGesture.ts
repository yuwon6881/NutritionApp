import {useEffect,useRef,useState,type PointerEvent,type RefObject} from 'react';
import {useFrameTask} from './useFrameTask';
import {useGestureRect} from './useGestureRect';

export function usePointerGesture<T extends Element>(
  target:RefObject<T|null>,update:(x:number,y:number,initial:boolean)=>void,enabled=true
) {
  const active=useRef<number|null>(null);
  const moved=useRef(false);
  const [dragging,setDragging]=useState(false);
  const geometry=useGestureRect(target);
  const position=useFrameTask(({x,y,initial}:{x:number;y:number;initial:boolean})=>update(x,y,initial));
  const reset=()=>{position.cancel();active.current=null;moved.current=false;geometry.invalidate();setDragging(false);};
  useEffect(()=>{if(!enabled)reset();},[enabled]);
  return {
    dragging,geometry,cancel:reset,
    bind:{
      onPointerDown:(event:PointerEvent<T>)=>{
        if(!enabled||event.button!==0||active.current!==null)return;
        geometry.invalidate();active.current=event.pointerId;moved.current=false;setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        position.schedule({x:event.clientX,y:event.clientY,initial:true});position.flush();
      },
      onPointerMove:(event:PointerEvent<T>)=>{
        if(active.current!==event.pointerId)return;
        moved.current=true;position.schedule({x:event.clientX,y:event.clientY,initial:false});
      },
      onPointerUp:(event:PointerEvent<T>)=>{
        if(active.current!==event.pointerId)return;
        if(moved.current)position.schedule({x:event.clientX,y:event.clientY,initial:false});
        position.flush();reset();
        if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel:(event:PointerEvent<T>)=>{if(active.current===event.pointerId)reset();},
      onLostPointerCapture:()=>reset()
    }
  };
}

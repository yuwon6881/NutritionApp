import {useRef} from 'react';

const AXIS_LOCK_PX=10;
const SWIPE_DISTANCE_PX=48;

/**
 * Recognises a deliberate sideways touch swipe on an element whose CSS
 * allows vertical panning (`touch-action: pan-y`). Vertical movement is left
 * to the page; mouse input is ignored because it has explicit buttons.
 * `onSwipe(-1)` means the finger moved right (toward earlier content).
 */
export function useHorizontalSwipe(onSwipe:(direction:-1|1)=>void,enabled=true){
  const gesture=useRef<{id:number;x:number;y:number;axis?:'x'|'y'}|null>(null);
  const suppressClick=useRef(false);
  return {
    onPointerDown:(event:React.PointerEvent<HTMLElement>)=>{
      // Any new press ends the previous swipe's claim on the click that may follow it.
      suppressClick.current=false;
      if(!enabled||!event.isPrimary||event.pointerType==='mouse')return;
      gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY};
    },
    onPointerMove:(event:React.PointerEvent<HTMLElement>)=>{
      const current=gesture.current;
      if(!current||current.id!==event.pointerId||current.axis)return;
      const dx=event.clientX-current.x,dy=event.clientY-current.y;
      if(Math.max(Math.abs(dx),Math.abs(dy))>=AXIS_LOCK_PX)current.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
    },
    onPointerUp:(event:React.PointerEvent<HTMLElement>)=>{
      const current=gesture.current;
      gesture.current=null;
      if(!current||current.id!==event.pointerId||current.axis!=='x')return;
      const dx=event.clientX-current.x;
      if(Math.abs(dx)<SWIPE_DISTANCE_PX)return;
      suppressClick.current=true;
      onSwipe(dx>0?-1:1);
    },
    onPointerCancel:()=>{gesture.current=null;},
    // A swipe that ends over a chip must not also tap it.
    onClickCapture:(event:React.MouseEvent<HTMLElement>)=>{
      if(!suppressClick.current)return;
      suppressClick.current=false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

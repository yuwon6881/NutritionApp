import {useCallback,useEffect,useRef,useState} from 'react';
import type {Entry} from '../types';
import {dropTarget,type DropRow} from '../lib/foodDiary';
import {CARD_HOLD_MS,idleCardGesture,stepCardGesture,type CardGestureEvent,type CardGestureState} from '../lib/cardGesture';
import {hapticTick} from '../lib/haptics';

interface ActiveGesture {
  entry:Entry;
  targetEl:HTMLElement;
  pointerId:number;
  gesture:CardGestureState;
  holdTimer?:ReturnType<typeof setTimeout>;
  rowRects:DropRow[];
  currentTargetTime?:string;
}

const INTERACTIVE='button,a,input,select,textarea,summary,.food-card-select-checkbox';

function snapshotRows():DropRow[]{
  return Array.from(document.querySelectorAll<HTMLElement>('.food-time-row[data-time-row]'))
    .filter(el=>el.dataset.timeRow)
    .map(el=>{
      const rect=el.getBoundingClientRect();
      return {time:el.dataset.timeRow!,top:rect.top,bottom:rect.bottom};
    });
}

/**
 * The tap the browser may synthesize after a hold-release lands wherever is
 * under the finger — the card, or the selection bar that just appeared there —
 * and would immediately undo the new selection.
 */
function swallowNextClick(){
  const swallow=(event:Event)=>{event.preventDefault();event.stopPropagation();};
  document.addEventListener('click',swallow,{capture:true,once:true});
  window.setTimeout(()=>document.removeEventListener('click',swallow,{capture:true}),500);
}

/**
 * Pointer handling for diary cards: touch hold selects or drags (see
 * lib/cardGesture), mouse drags after a short movement. All transient state
 * — hold timer, pointer capture, and the scroll lock — is released on every
 * exit path so the page can never stay unscrollable.
 */
export function useTimelineDrag({
  enabled,
  onDrop,
  onHoldSelect,
}:{
  enabled:boolean;
  onDrop:(entry:Entry,targetTime:string)=>void;
  onHoldSelect:(entry:Entry)=>void;
}){
  const [draggingEntry,setDraggingEntry]=useState<Entry|null>(null);
  const [dropOverTime,setDropOverTime]=useState<string|null>(null);
  const activeRef=useRef<ActiveGesture|null>(null);

  const reset=useCallback(()=>{
    const current=activeRef.current;
    if(current?.holdTimer)clearTimeout(current.holdTimer);
    if(current){
      try{current.targetEl.releasePointerCapture(current.pointerId);}catch{/* Capture may already be gone. */}
    }
    activeRef.current=null;
    setDraggingEntry(null);
    setDropOverTime(null);
  },[]);

  useEffect(()=>{if(!enabled)reset();},[enabled,reset]);
  useEffect(()=>reset,[reset]);

  // Once a card is lifted the finger belongs to the card, not the page.
  useEffect(()=>{
    if(!draggingEntry)return;
    const blockTouch=(event:TouchEvent)=>{if(event.cancelable)event.preventDefault();};
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')reset();};
    window.addEventListener('touchmove',blockTouch,{passive:false});
    window.addEventListener('keydown',onKey);
    window.addEventListener('blur',reset);
    return()=>{
      window.removeEventListener('touchmove',blockTouch);
      window.removeEventListener('keydown',onKey);
      window.removeEventListener('blur',reset);
    };
  },[draggingEntry,reset]);

  const updateTarget=(current:ActiveGesture,clientY:number)=>{
    const target=dropTarget(current.rowRects,clientY);
    current.currentTargetTime=target;
    setDropOverTime(target??null);
  };

  const dispatch=(current:ActiveGesture,event:CardGestureEvent,clientY?:number)=>{
    const {state,effect}=stepCardGesture(current.gesture,event);
    current.gesture=state;
    switch(effect){
      case 'start-hold-timer':
        current.holdTimer=setTimeout(()=>{
          if(activeRef.current===current)dispatch(current,{type:'hold'},current.gesture.originY);
        },CARD_HOLD_MS);
        break;
      case 'lift':
      case 'begin-drag':
        if(!current.rowRects.length)current.rowRects=snapshotRows();
        if(effect==='lift')hapticTick();
        setDraggingEntry(current.entry);
        updateTarget(current,clientY??current.gesture.originY);
        break;
      case 'track':
        if(clientY!==undefined)updateTarget(current,clientY);
        break;
      case 'drop':{
        const {entry,currentTargetTime}=current;
        reset();
        if(currentTargetTime&&currentTargetTime!==(entry.time??null))onDrop(entry,currentTargetTime);
        break;
      }
      case 'select':{
        const {entry}=current;
        reset();
        swallowNextClick();
        onHoldSelect(entry);
        break;
      }
      case 'abort':
        reset();
        break;
      case 'none':
        break;
    }
  };

  const onPointerDown=(entry:Entry,event:React.PointerEvent<HTMLElement>)=>{
    if(!enabled||!event.isPrimary)return;
    if(event.pointerType==='mouse'&&event.button!==0)return;
    if((event.target as HTMLElement).closest(INTERACTIVE))return;
    reset();
    const current:ActiveGesture={entry,targetEl:event.currentTarget,pointerId:event.pointerId,gesture:idleCardGesture,rowRects:[]};
    activeRef.current=current;
    try{current.targetEl.setPointerCapture(current.pointerId);}catch{/* Capture is an enhancement. */}
    dispatch(current,{type:'down',pointerType:event.pointerType,x:event.clientX,y:event.clientY});
  };

  const forActive=(event:React.PointerEvent<HTMLElement>,action:(current:ActiveGesture)=>void)=>{
    const current=activeRef.current;
    if(current&&current.pointerId===event.pointerId)action(current);
  };

  return {
    draggingEntry,
    dropOverTime,
    bindDrag:(entry:Entry)=>({
      onPointerDown:(event:React.PointerEvent<HTMLElement>)=>onPointerDown(entry,event),
      onPointerMove:(event:React.PointerEvent<HTMLElement>)=>forActive(event,current=>dispatch(current,{type:'move',x:event.clientX,y:event.clientY},event.clientY)),
      onPointerUp:(event:React.PointerEvent<HTMLElement>)=>forActive(event,current=>dispatch(current,{type:'up'})),
      onPointerCancel:(event:React.PointerEvent<HTMLElement>)=>forActive(event,current=>dispatch(current,{type:'cancel'})),
      // Android would otherwise open its own long-press menu over the lifted card.
      onContextMenu:(event:React.MouseEvent<HTMLElement>)=>{if(activeRef.current?.gesture.touch)event.preventDefault();},
      'data-draggable':enabled?true:undefined,
      'data-dragging':draggingEntry?.id===entry.id?true:undefined,
    }),
  };
}

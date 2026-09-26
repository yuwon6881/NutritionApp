import {useCallback,useEffect,useRef,useState} from 'react';
import type {Entry} from '../types';
import {dropTarget,type DropRow} from '../lib/foodDiary';
import {CARD_HOLD_MS,idleCardGesture,stepCardGesture,type CardGestureEvent,type CardGestureState} from '../lib/cardGesture';
import {hapticTick} from '../lib/haptics';
import {settlesOpen,swipeOffset} from '../lib/swipeReveal';

/** Width of the Copy / Move / Delete actions revealed behind a swiped card. */
export const CARD_REVEAL_WIDTH=204;

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
 * Pointer handling for diary cards: touch hold selects or drags, a sideways
 * touch swipe reveals actions (see lib/cardGesture), mouse drags after a
 * short movement. All transient state
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
  const [swipe,setSwipe]=useState<{id:string;offset:number}|null>(null);
  const [revealedId,setRevealedId]=useState<string|null>(null);

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

  useEffect(()=>{if(!enabled){reset();setRevealedId(null);setSwipe(null);}},[enabled,reset]);

  // A revealed card closes when the person touches anything outside it.
  useEffect(()=>{
    if(!revealedId)return;
    const close=(event:PointerEvent)=>{
      if(!(event.target as Element|null)?.closest(`[data-swipe-id="${CSS.escape(revealedId)}"]`))setRevealedId(null);
    };
    document.addEventListener('pointerdown',close);
    return()=>document.removeEventListener('pointerdown',close);
  },[revealedId]);
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

  const dispatch=(current:ActiveGesture,event:CardGestureEvent,clientY?:number,clientX?:number)=>{
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
      case 'begin-swipe':
        if(current.holdTimer)clearTimeout(current.holdTimer);
        // falls through to position the card under the finger
      case 'swipe-track':
        if(clientX!==undefined)setSwipe({id:current.entry.id,offset:swipeOffset(clientX-current.gesture.originX,revealedId===current.entry.id,CARD_REVEAL_WIDTH)});
        break;
      case 'swipe-end':{
        const {entry}=current;
        const open=swipe?.id===entry.id?settlesOpen(swipe.offset,CARD_REVEAL_WIDTH):revealedId===entry.id;
        reset();
        setSwipe(null);
        // A moved touch produces no synthetic click, so nothing needs swallowing here.
        if(open&&revealedId!==entry.id)hapticTick();
        setRevealedId(open?entry.id:null);
        break;
      }
      case 'abort':
        reset();
        setSwipe(null);
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
    /** Live swipe offset (px, ≤ 0) and whether the card's actions are open. */
    swipeFor:(entry:Entry)=>({offset:swipe?.id===entry.id?swipe.offset:revealedId===entry.id?-CARD_REVEAL_WIDTH:0,dragging:swipe?.id===entry.id,revealed:revealedId===entry.id}),
    closeReveal:()=>setRevealedId(null),
    bindDrag:(entry:Entry)=>({
      onPointerDown:(event:React.PointerEvent<HTMLElement>)=>onPointerDown(entry,event),
      onPointerMove:(event:React.PointerEvent<HTMLElement>)=>forActive(event,current=>dispatch(current,{type:'move',x:event.clientX,y:event.clientY},event.clientY,event.clientX)),
      onPointerUp:(event:React.PointerEvent<HTMLElement>)=>forActive(event,current=>dispatch(current,{type:'up'})),
      onPointerCancel:(event:React.PointerEvent<HTMLElement>)=>forActive(event,current=>dispatch(current,{type:'cancel'})),
      // Android would otherwise open its own long-press menu over the lifted card.
      onContextMenu:(event:React.MouseEvent<HTMLElement>)=>{if(activeRef.current?.gesture.touch)event.preventDefault();},
      'data-draggable':enabled?true:undefined,
      'data-dragging':draggingEntry?.id===entry.id?true:undefined,
    }),
  };
}

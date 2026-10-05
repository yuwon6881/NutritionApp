import {useCallback,useEffect,useRef,useState} from 'react';
import type {Entry} from '../types';
import {dropTarget,type DropRow} from '../lib/foodDiary';
import {CARD_HOLD_MS,idleCardGesture,stepCardGesture,type CardGestureEvent,type CardGestureState} from '../lib/cardGesture';
import {hapticTick} from '../lib/haptics';
import {settlesOpen,swipeOffset} from '../lib/swipeReveal';
import {useFrameTask} from './ui/useFrameTask';
import {autoScrollStep} from '../lib/dragAutoScroll';
import {createDragGhost,visibleScrollBand,type DragGhost} from './timelineDragSurface';

/** Width of the Copy / Move / Delete actions revealed behind a swiped card. */
export const CARD_REVEAL_WIDTH=204;

interface ActiveGesture {
  entry:Entry;
  targetEl:HTMLElement;
  pointerId:number;
  gesture:CardGestureState;
  holdTimer?:ReturnType<typeof setTimeout>;
  mouseHoldTimer?:ReturnType<typeof setTimeout>;
  rowRects:DropRow[];
  currentTargetTime?:string;
  swipeElement:HTMLElement|null;
  swipeOffset?:number;
  lastX:number;
  lastY:number;
  ghost?:DragGhost;
  autoScrollFrame?:number;
  /** Removes the touch-scroll blocker added for this pointer. */
  releaseTouch?:()=>void;
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
  const revealedRef=useRef(revealedId);
  revealedRef.current=revealedId;
  const swipeFrame=useFrameTask((current:ActiveGesture)=>{
    if(activeRef.current===current)current.swipeElement?.style.setProperty('--swipe-x',`${current.swipeOffset??0}px`);
  });
  const targetFrame=useFrameTask((current:ActiveGesture)=>{
    if(activeRef.current!==current)return;
    current.ghost?.move(current.lastX,current.lastY);
    if(!current.rowRects.length)current.rowRects=snapshotRows();
    updateTarget(current,current.lastY);
  });

  const reset=useCallback(()=>{
    swipeFrame.cancel();targetFrame.cancel();
    const current=activeRef.current;
    if(current?.holdTimer)clearTimeout(current.holdTimer);
    if(current?.mouseHoldTimer)clearTimeout(current.mouseHoldTimer);
    if(current){
      if(current.autoScrollFrame!==undefined)cancelAnimationFrame(current.autoScrollFrame);
      current.ghost?.remove();
      current.releaseTouch?.();
      current.swipeElement?.style.setProperty('--swipe-x',revealedRef.current===current.entry.id?`${-CARD_REVEAL_WIDTH}px`:'0px');
      try{current.targetEl.releasePointerCapture(current.pointerId);}catch{/* Capture may already be gone. */}
    }
    activeRef.current=null;
    delete document.documentElement.dataset.cardDragging;
    setDraggingEntry(null);
    setDropOverTime(null);
  },[swipeFrame,targetFrame]);

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
  useEffect(()=>{
    // Rows move under a still pointer while the page scrolls, so the hour is picked again.
    const invalidate=()=>{
      const current=activeRef.current;
      if(!current)return;
      current.rowRects=[];
      if(current.gesture.phase==='dragging')targetFrame.schedule(current);
    };
    window.addEventListener('resize',invalidate);window.addEventListener('scroll',invalidate,true);
    return()=>{window.removeEventListener('resize',invalidate);window.removeEventListener('scroll',invalidate,true);};
  },[targetFrame]);

  useEffect(()=>{
    if(!draggingEntry)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')cancelDrag();};
    window.addEventListener('keydown',onKey);
    window.addEventListener('blur',reset);
    return()=>{
      window.removeEventListener('keydown',onKey);
      window.removeEventListener('blur',reset);
    };
  });

  /** Ends the gesture with the floating card gliding back to where it came from. */
  const cancelDrag=()=>{
    const current=activeRef.current;
    if(current?.mouseHoldTimer)clearTimeout(current.mouseHoldTimer);
    const ghost=current?.ghost;
    if(current)current.ghost=undefined;
    reset();
    setSwipe(null);
    ghost?.returnHome();
  };

  /**
   * Once a card is lifted the finger belongs to the card, not the page. The
   * blocker is attached on touch-down, before the browser decides whether the
   * first move pans, so a move right after the lift cannot start a scroll.
   */
  const blockTouchScroll=(current:ActiveGesture)=>{
    const block=(event:TouchEvent)=>{
      const phase=current.gesture.phase;
      if(event.cancelable&&(phase==='lifted'||phase==='dragging'))event.preventDefault();
    };
    window.addEventListener('touchmove',block,{passive:false});
    current.releaseTouch=()=>window.removeEventListener('touchmove',block);
  };

  const lift=(current:ActiveGesture)=>{
    if(current.ghost)return;
    current.ghost=createDragGhost(current.targetEl,current.gesture.originX,current.gesture.originY);
    document.documentElement.dataset.cardDragging='true';
    window.getSelection()?.removeAllRanges();
  };

  // The visible band is measured once per drag; fixed chrome does not move while a card is held.
  const autoScroll=(current:ActiveGesture,band=visibleScrollBand())=>{
    current.autoScrollFrame=requestAnimationFrame(()=>{
      if(activeRef.current!==current||current.gesture.phase!=='dragging')return;
      const step=autoScrollStep(current.lastY,band);
      if(step!==0)window.scrollBy(0,step);
      autoScroll(current,band);
    });
  };

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
        lift(current);
        if(effect==='begin-drag'){
          if(current.mouseHoldTimer)clearTimeout(current.mouseHoldTimer);
          current.ghost?.move(current.lastX,current.lastY);
          autoScroll(current);
        }
        setDraggingEntry(current.entry);
        updateTarget(current,clientY??current.gesture.originY);
        break;
      case 'track':
        targetFrame.schedule(current);
        break;
      case 'drop':{
        const {entry,currentTargetTime}=current;
        if(currentTargetTime&&currentTargetTime!==(entry.time??null)){
          // The card reappears in its new hour with the moved animation.
          reset();
          onDrop(entry,currentTargetTime);
        }else cancelDrag();
        break;
      }
      case 'select':{
        if(current.mouseHoldTimer)clearTimeout(current.mouseHoldTimer);
        const {entry}=current;
        reset();
        swallowNextClick();
        onHoldSelect(entry);
        break;
      }
      case 'begin-swipe':
        if(current.holdTimer)clearTimeout(current.holdTimer);
        setSwipe({id:current.entry.id,offset:revealedId===current.entry.id?-CARD_REVEAL_WIDTH:0});
        // falls through to position the card under the finger
      case 'swipe-track':
        if(clientX!==undefined){
          current.swipeOffset=swipeOffset(clientX-current.gesture.originX,revealedId===current.entry.id,CARD_REVEAL_WIDTH);
          swipeFrame.schedule(current);
        }
        break;
      case 'swipe-end':{
        const {entry}=current;
        const open=current.swipeOffset!==undefined?settlesOpen(current.swipeOffset,CARD_REVEAL_WIDTH):revealedId===entry.id;
        reset();
        current.swipeElement?.style.setProperty('--swipe-x',open?`${-CARD_REVEAL_WIDTH}px`:'0px');
        setSwipe(null);
        // A moved touch produces no synthetic click, so nothing needs swallowing here.
        if(open&&revealedId!==entry.id)hapticTick();
        setRevealedId(open?entry.id:null);
        break;
      }
      case 'abort':
        cancelDrag();
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
    const current:ActiveGesture={entry,targetEl:event.currentTarget,pointerId:event.pointerId,gesture:idleCardGesture,rowRects:[],
      swipeElement:event.currentTarget.closest<HTMLElement>('.food-card-swipe'),lastX:event.clientX,lastY:event.clientY};
    activeRef.current=current;
    if(event.pointerType==='touch')blockTouchScroll(current);
    try{current.targetEl.setPointerCapture(current.pointerId);}catch{/* Capture is an enhancement. */}
    if(event.pointerType==='mouse'){
      current.mouseHoldTimer=setTimeout(()=>{
        if(activeRef.current===current&&current.gesture.phase==='pending'){
          const {entry:held}=current;
          reset();
          swallowNextClick();
          hapticTick();
          onHoldSelect(held);
        }
      },500);
    }
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
    closeReveal:useCallback(()=>setRevealedId(null),[]),
    bindDrag:(entry:Entry)=>({
      onPointerDown:(event:React.PointerEvent<HTMLElement>)=>onPointerDown(entry,event),
      onPointerMove:(event:React.PointerEvent<HTMLElement>)=>forActive(event,current=>{
        if(current.mouseHoldTimer&&Math.hypot(event.clientX-current.gesture.originX,event.clientY-current.gesture.originY)>=8){
          clearTimeout(current.mouseHoldTimer);
          current.mouseHoldTimer=undefined;
        }
        current.lastX=event.clientX;current.lastY=event.clientY;
        dispatch(current,{type:'move',x:event.clientX,y:event.clientY},event.clientY,event.clientX);
      }),
      onPointerUp:(event:React.PointerEvent<HTMLElement>)=>forActive(event,current=>{
        if(current.mouseHoldTimer){
          clearTimeout(current.mouseHoldTimer);
          current.mouseHoldTimer=undefined;
        }
        current.lastX=event.clientX;current.lastY=event.clientY;
        if(current.gesture.phase==='swiping'||current.gesture.phase==='dragging')dispatch(current,{type:'move',x:event.clientX,y:event.clientY},event.clientY,event.clientX);
        targetFrame.flush();swipeFrame.flush();dispatch(current,{type:'up'});
      }),
      onPointerCancel:(event:React.PointerEvent<HTMLElement>)=>forActive(event,current=>dispatch(current,{type:'cancel'})),
      // Android would otherwise open its own long-press menu over the lifted card.
      onContextMenu:(event:React.MouseEvent<HTMLElement>)=>{if(activeRef.current?.gesture.touch)event.preventDefault();},
      'data-draggable':enabled?true:undefined,
      'data-dragging':draggingEntry?.id===entry.id?true:undefined,
    }),
  };
}

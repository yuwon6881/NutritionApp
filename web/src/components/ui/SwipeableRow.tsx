import {useCallback,useEffect,useRef,useState,type PointerEvent as ReactPointerEvent,type ReactNode} from 'react';
import {useIsCompact} from '../../lib/breakpoints';
import {clearSwipeRow,closeOpenSwipeRow,registerSwipeRow,resolveSwipeAxis,resolveSwipeTarget} from '../../lib/swipeRow';
import {useReducedMotion} from './Motion';

export interface SwipeableRowProps{
  children:ReactNode;
  /** Secondary actions for this row. Inline on medium and expanded screens, swipe-revealed on compact. */
  actions:ReactNode;
  /** Accessible name of the revealed action group, e.g. "Greek Yogurt 0% actions". */
  actionsLabel:string;
  /** Must match the rendered width of the action tray. */
  actionsWidth?:number;
  className?:string;
  disabled?:boolean;
}

/**
 * A row whose secondary actions stay inline on wider screens and hide behind a
 * horizontal swipe on compact screens. The actions remain in the accessibility
 * tree at all times: focusing one opens the row, so the keyboard and screen
 * reader paths never depend on the gesture.
 */
export function SwipeableRow({
  children,
  actions,
  actionsLabel,
  actionsWidth=112,
  className='',
  disabled=false,
}:SwipeableRowProps){
  const compact=useIsCompact();
  const reduced=useReducedMotion();
  const [open,setOpen]=useState(false);
  const content=useRef<HTMLDivElement>(null);
  const offset=useRef(0);
  const suppressClick=useRef(false);
  const gesture=useRef<{
    pointerId:number;
    startX:number;
    startY:number;
    baseX:number;
    axis:'x'|'y'|null;
    lastX:number;
    lastTime:number;
    velocity:number;
    moved:boolean;
  }|null>(null);

  const place=useCallback((x:number,animate:boolean)=>{
    offset.current=x;
    const node=content.current;
    if(!node)return;
    node.style.transition=animate&&!reduced?'transform .22s cubic-bezier(.2,.8,.2,1)':'none';
    node.style.transform=x?`translateX(${x}px)`:'';
  },[reduced]);

  const close=useCallback(()=>{
    setOpen(false);
    place(0,true);
  },[place]);

  const reveal=useCallback(()=>{
    if(disabled)return;
    setOpen(true);
    place(-actionsWidth,true);
  },[actionsWidth,disabled,place]);

  // Collapse when the row can no longer be swiped, so a stale offset never
  // survives a resize across the inline layout.
  useEffect(()=>{
    offset.current=0;
    gesture.current=null;
    setOpen(false);
  },[compact,disabled]);

  useEffect(()=>{
    if(!open)return;
    registerSwipeRow(close);
    const onKey=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown',onKey);
    return()=>{
      document.removeEventListener('keydown',onKey);
      clearSwipeRow(close);
    };
  },[close,open]);

  // The gesture follows the pointer on `window` rather than on the row. Pointer
  // capture would retarget events away from the row the moment the drag starts,
  // and a pointer that leaves the row mid-drag still has to finish its swipe.
  useEffect(()=>{
    if(!compact||disabled)return;
    const move=(event:PointerEvent)=>{
      const active=gesture.current;
      if(!active||active.pointerId!==event.pointerId)return;
      const dx=event.clientX-active.startX;
      const dy=event.clientY-active.startY;
      if(!active.axis){
        active.axis=resolveSwipeAxis(dx,dy);
        if(!active.axis)return;
        if(active.axis==='y'){gesture.current=null;return;}
        closeOpenSwipeRow();
      }
      const elapsed=event.timeStamp-active.lastTime;
      if(elapsed>0){
        active.velocity=(event.clientX-active.lastX)/elapsed;
        active.lastX=event.clientX;
        active.lastTime=event.timeStamp;
      }
      active.moved=true;
      if(event.cancelable)event.preventDefault();
      place(Math.max(-actionsWidth,Math.min(0,active.baseX+dx)),false);
    };
    const end=(event:PointerEvent)=>{
      const active=gesture.current;
      if(!active||active.pointerId!==event.pointerId)return;
      gesture.current=null;
      if(active.axis!=='x')return;
      const target=resolveSwipeTarget({
        currentX:offset.current,
        actionsWidth,
        velocityX:active.velocity,
      });
      if(target<0)reveal();else close();
      // A finished drag emits a trailing click on whatever the pointer ended on.
      // Swallow exactly that one click: it is part of the gesture, not a tap, and
      // must not reach a control or undo the state the gesture just settled on.
      if(active.moved){
        suppressClick.current=true;
        requestAnimationFrame(()=>requestAnimationFrame(()=>{suppressClick.current=false;}));
      }
    };
    window.addEventListener('pointermove',move,{passive:false});
    window.addEventListener('pointerup',end);
    window.addEventListener('pointercancel',end);
    return()=>{
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',end);
      window.removeEventListener('pointercancel',end);
    };
  },[actionsWidth,close,compact,disabled,place,reveal]);

  const onPointerDown=(event:ReactPointerEvent<HTMLDivElement>)=>{
    if(disabled||!compact||gesture.current)return;
    // A gesture that starts inside a form control belongs to that control.
    if((event.target as HTMLElement).closest('input,select,textarea'))return;
    gesture.current={
      pointerId:event.pointerId,
      startX:event.clientX,
      startY:event.clientY,
      baseX:offset.current,
      axis:null,
      lastX:event.clientX,
      lastTime:event.timeStamp,
      velocity:0,
      moved:false,
    };
  };

  if(!compact){
    return <div className={className}>
      {children}
      {actions}
    </div>;
  }

  return <div className="swipe-row" data-open={open||undefined} data-disabled={disabled||undefined}>
    <div
      className="swipe-row-actions"
      role="group"
      aria-label={actionsLabel}
      style={{width:actionsWidth}}
      onFocusCapture={reveal}
      onClickCapture={close}
    >
      {actions}
    </div>
    <div
      ref={content}
      className={`swipe-row-content ${className}`.trim()}
      onPointerDown={onPointerDown}
      onClickCapture={event=>{
        if(suppressClick.current){
          suppressClick.current=false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // While the actions are showing, a tap on the row only dismisses them.
        if(open){
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      {children}
    </div>
  </div>;
}

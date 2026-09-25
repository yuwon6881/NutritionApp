/**
 * One gesture model for diary cards, so press-and-hold selection and
 * press-and-hold drag never compete for the same touch.
 *
 * Touch: hold still for HOLD_MS to lift the card. Releasing without moving
 * selects it; moving after the lift drags it to another time. Moving before
 * the lift abandons the gesture so the page can scroll.
 * Mouse/pen: moving past the tolerance begins a drag immediately.
 */
export const CARD_HOLD_MS=400;
export const CARD_MOVE_TOLERANCE_PX=8;

export type CardGesturePhase='idle'|'pending'|'lifted'|'dragging';

export interface CardGestureState {
  phase:CardGesturePhase;
  touch:boolean;
  originX:number;
  originY:number;
}

export type CardGestureEvent=
  |{type:'down';pointerType:string;x:number;y:number}
  |{type:'move';x:number;y:number}
  |{type:'hold'}
  |{type:'up'}
  |{type:'cancel'};

/** Side effect the caller performs after a transition. */
export type CardGestureEffect='none'|'start-hold-timer'|'lift'|'begin-drag'|'track'|'drop'|'select'|'abort';

export const idleCardGesture:CardGestureState={phase:'idle',touch:false,originX:0,originY:0};

function movedBeyondTolerance(state:CardGestureState,x:number,y:number){
  return Math.hypot(x-state.originX,y-state.originY)>=CARD_MOVE_TOLERANCE_PX;
}

export function stepCardGesture(state:CardGestureState,event:CardGestureEvent):{state:CardGestureState;effect:CardGestureEffect}{
  if(event.type==='cancel'){
    return {state:idleCardGesture,effect:state.phase==='idle'?'none':'abort'};
  }
  switch(state.phase){
    case 'idle':
      if(event.type!=='down')return {state,effect:'none'};
      {
        const touch=event.pointerType==='touch';
        return {
          state:{phase:'pending',touch,originX:event.x,originY:event.y},
          effect:touch?'start-hold-timer':'none',
        };
      }
    case 'pending':
      if(event.type==='hold'&&state.touch)return {state:{...state,phase:'lifted'},effect:'lift'};
      if(event.type==='move'&&movedBeyondTolerance(state,event.x,event.y)){
        return state.touch
          ?{state:idleCardGesture,effect:'abort'}
          :{state:{...state,phase:'dragging'},effect:'begin-drag'};
      }
      if(event.type==='up')return {state:idleCardGesture,effect:'abort'};
      return {state,effect:'none'};
    case 'lifted':
      if(event.type==='move'&&movedBeyondTolerance(state,event.x,event.y)){
        return {state:{...state,phase:'dragging'},effect:'begin-drag'};
      }
      if(event.type==='up')return {state:idleCardGesture,effect:'select'};
      return {state,effect:'none'};
    case 'dragging':
      if(event.type==='move')return {state,effect:'track'};
      if(event.type==='up')return {state:idleCardGesture,effect:'drop'};
      return {state,effect:'none'};
  }
}

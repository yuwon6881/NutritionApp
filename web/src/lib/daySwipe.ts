/**
 * Geometry for swiping the Food Log between days. A finger moving left brings
 * the next day, moving right the previous one. Pure so the thresholds are
 * testable without a browser.
 */
export const DAY_SWIPE_LOCK_PX=10;
export const DAY_SWIPE_COMMIT_PX=64;
/** A short, quick flick commits before it reaches the full distance. */
export const DAY_SWIPE_FLICK_PX=24;
export const DAY_SWIPE_FLICK_SPEED=.5;
/** Touches this close to the screen edge belong to the system back gesture. */
export const DAY_SWIPE_EDGE_PX=24;
const RESISTANCE=.25;

export type SwipeAxis='pending'|'horizontal'|'vertical';

/** Decide the gesture's axis once the finger has moved; a diagonal scroll stays a scroll. */
export function lockAxis(dx:number,dy:number):SwipeAxis{
  const x=Math.abs(dx),y=Math.abs(dy);
  if(x>=DAY_SWIPE_LOCK_PX&&x>y*1.5)return 'horizontal';
  if(y>=DAY_SWIPE_LOCK_PX)return 'vertical';
  return 'pending';
}

/** The day delta a drag moves towards: +1 (next) when dragging left, −1 (previous) when dragging right. */
export function dragDirection(dx:number):-1|0|1{
  return dx<0?1:dx>0?-1:0;
}

/** The content follows the finger one-to-one, and resists where there is no day to go to. */
export function swipeTranslate(dx:number,canPrevious:boolean,canNext:boolean){
  const direction=dragDirection(dx);
  const allowed=direction===1?canNext:direction===-1?canPrevious:true;
  return allowed?dx:dx*RESISTANCE;
}

/** The day to open when the finger lifts, or 0 to settle back. */
export function swipeOutcome(dx:number,elapsedMs:number,canPrevious:boolean,canNext:boolean):-1|0|1{
  const direction=dragDirection(dx);
  if(direction===0||(direction===1&&!canNext)||(direction===-1&&!canPrevious))return 0;
  const distance=Math.abs(dx);
  const speed=distance/Math.max(1,elapsedMs);
  return distance>=DAY_SWIPE_COMMIT_PX||(distance>=DAY_SWIPE_FLICK_PX&&speed>=DAY_SWIPE_FLICK_SPEED)?direction:0;
}

/** Whether a touch starting at this x may begin a day swipe. */
export function startsOutsideEdge(x:number,viewportWidth:number){
  return x>=DAY_SWIPE_EDGE_PX&&x<=viewportWidth-DAY_SWIPE_EDGE_PX;
}

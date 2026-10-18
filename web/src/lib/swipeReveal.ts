/**
 * Swipe-to-reveal geometry shared by swipeable rows: the row follows the
 * finger leftwards up to the width of its actions, and settles open when
 * dragged past half of that width or flicked left at speed.
 */
export function swipeOffset(dx:number,startOpen:boolean,revealWidth:number){
  const start=startOpen?-revealWidth:0;
  return Math.max(-revealWidth,Math.min(0,start+dx));
}

/** A release at least this fast (px/ms) decides the side by direction alone. */
export const SWIPE_FLICK_SPEED=.3;
/** Only the movement in this window before the last move counts toward the flick speed. */
const SWIPE_VELOCITY_WINDOW_MS=150;
/** A finger that rests this long between its last move and lifting has not flicked. */
const SWIPE_STILL_MS=60;

export interface SwipeSample {x:number;t:number}

/**
 * Horizontal speed (px/ms, negative leftwards) over the finger's last moves
 * before it lifted at `releasedAt`. A quick flick covers little distance, so
 * position alone would let it fall back shut. Samples are pointer moves only:
 * the release repeats the last position, and counting it would dilute the speed.
 */
export function releaseVelocity(samples:readonly SwipeSample[],releasedAt:number){
  const last=samples.at(-1);
  if(!last||releasedAt-last.t>SWIPE_STILL_MS)return 0;
  const first=samples.find(sample=>last.t-sample.t<=SWIPE_VELOCITY_WINDOW_MS)??last;
  const elapsed=last.t-first.t;
  return elapsed>0?(last.x-first.x)/elapsed:0;
}

export function settlesOpen(offset:number,revealWidth:number,velocity=0){
  if(velocity<=-SWIPE_FLICK_SPEED)return offset<0;
  if(velocity>=SWIPE_FLICK_SPEED)return false;
  return offset<=-revealWidth/2;
}

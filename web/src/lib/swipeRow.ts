/** Settle position for a released swipe: either fully open or fully closed. */
export function resolveSwipeTarget({
  currentX,
  actionsWidth,
  velocityX,
  velocityThreshold=0.5,
}:{
  currentX:number;
  actionsWidth:number;
  /** Pixels per millisecond; negative travels toward the open (trailing) side. */
  velocityX:number;
  velocityThreshold?:number;
}):number{
  const bounded=Math.max(-actionsWidth,Math.min(0,currentX));
  if(velocityX<=-velocityThreshold)return -actionsWidth;
  if(velocityX>=velocityThreshold)return 0;
  return bounded<-actionsWidth/2?-actionsWidth:0;
}

/** Decide whether a gesture is a row swipe or a page scroll, once per gesture. */
export function resolveSwipeAxis(dx:number,dy:number,threshold=8):'x'|'y'|null{
  if(Math.abs(dx)<threshold&&Math.abs(dy)<threshold)return null;
  return Math.abs(dx)>Math.abs(dy)?'x':'y';
}

// Only one row stays open at a time, so a revealed action never sits behind the
// row the reader is actually looking at.
let closeActiveRow:(()=>void)|null=null;

export function registerSwipeRow(close:()=>void){
  if(closeActiveRow&&closeActiveRow!==close)closeActiveRow();
  closeActiveRow=close;
}

export function clearSwipeRow(close:()=>void){
  if(closeActiveRow===close)closeActiveRow=null;
}

export function closeOpenSwipeRow(){
  closeActiveRow?.();
}

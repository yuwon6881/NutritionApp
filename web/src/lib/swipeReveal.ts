/**
 * Swipe-to-reveal geometry shared by swipeable rows: the row follows the
 * finger leftwards up to the width of its actions, and settles open only when
 * dragged past half of that width.
 */
export function swipeOffset(dx:number,startOpen:boolean,revealWidth:number){
  const start=startOpen?-revealWidth:0;
  return Math.max(-revealWidth,Math.min(0,start+dx));
}

export function settlesOpen(offset:number,revealWidth:number){
  return offset<=-revealWidth/2;
}

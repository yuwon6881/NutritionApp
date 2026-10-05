/**
 * Edge auto-scroll while a diary card is dragged. A lifted card owns the
 * finger, so the page cannot be panned by hand; holding the card near the top
 * or bottom of the visible area scrolls toward hours that are off screen.
 */
export const AUTO_SCROLL_EDGE_PX=80;
export const AUTO_SCROLL_MAX_PX=16;

/** The part of the viewport not covered by fixed or sticky chrome. */
export interface ScrollBand {
  top:number;
  bottom:number;
}

/**
 * Pixels to scroll this frame for a pointer at `y`: negative scrolls up,
 * positive down, zero in the middle. Speed grows with depth into the edge
 * zone, so a card resting just inside the edge creeps and one pushed past it
 * (over the app bar or bottom navigation) scrolls at full speed.
 */
export function autoScrollStep(y:number,band:ScrollBand):number{
  const height=band.bottom-band.top;
  if(!(height>0))return 0;
  const edge=Math.min(AUTO_SCROLL_EDGE_PX,height/4);
  const speed=(depth:number)=>Math.ceil(AUTO_SCROLL_MAX_PX*Math.min(1,depth/edge)**2);
  if(y<band.top+edge)return -speed(band.top+edge-y);
  if(y>band.bottom-edge)return speed(y-(band.bottom-edge));
  return 0;
}

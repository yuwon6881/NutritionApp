import type {WindowTier} from './breakpoints';

/**
 * Pure geometry for the scrollable Progress bar charts. A phone shows about a
 * week of bars so each stays readable and tappable; wider windows show more
 * and the rest of the period is reached by scrolling, never by shrinking bars.
 */
const visibleBars:Record<WindowTier,number>={compact:7,medium:14,expanded:21};

export function visibleBarCount(tier:WindowTier){
  return visibleBars[tier];
}

/** Width of one bar slot: the viewport holds `visible` slots, or every slot when the series is shorter. */
export function barSlotWidth(viewportWidth:number,count:number,visible:number){
  if(viewportWidth<=0)return 0;
  return viewportWidth/Math.max(1,Math.min(count,visible));
}

/** The scroll offset that brings a slot fully into view, or null when it is already visible. */
export function revealScrollLeft(index:number,slot:number,scrollLeft:number,viewportWidth:number){
  if(slot<=0||index<0)return null;
  const start=index*slot;
  const end=start+slot;
  if(start<scrollLeft-.5)return start;
  if(end>scrollLeft+viewportWidth+.5)return end-viewportWidth;
  return null;
}

/** First and last slot indexes at least half inside the viewport. */
export function visibleRange(scrollLeft:number,viewportWidth:number,slot:number,count:number){
  if(slot<=0||count<=0)return {first:0,last:Math.max(0,count-1)};
  const first=Math.min(count-1,Math.max(0,Math.round(scrollLeft/slot)));
  const last=Math.min(count-1,Math.max(first,Math.round((scrollLeft+viewportWidth)/slot)-1));
  return {first,last};
}

/** A round step (1, 2, 2.5 or 5 × 10ⁿ) that splits `span` into about `count` intervals. */
export function niceStep(span:number,count:number){
  if(!(span>0)||count<1)return 1;
  const raw=span/count;
  const magnitude=10**Math.floor(Math.log10(raw));
  const fraction=raw/magnitude;
  const nice=fraction<=1?1:fraction<=2?2:fraction<=2.5?2.5:fraction<=5?5:10;
  return nice*magnitude;
}

/** Evenly spaced round ticks that cover [min, max]. */
export function niceTicks(min:number,max:number,count=4){
  if(!Number.isFinite(min)||!Number.isFinite(max))return [0,1];
  if(max<=min)return [min-1,min,min+1];
  const step=niceStep(max-min,count);
  const first=Math.floor(min/step+1e-9)*step;
  const last=Math.ceil(max/step-1e-9)*step;
  const ticks:number[]=[];
  for(let value=first;value<=last+step/2;value+=step)ticks.push(Number(value.toFixed(10)));
  return ticks;
}

/**
 * A stepped line through per-slot values: flat across each slot, joined by a
 * riser where the value changes. Missing values break the line, so an unknown
 * estimate is never drawn as a continuation of its neighbour.
 */
export function steppedPath(values:readonly (number|null)[],slot:number,y:(value:number)=>number){
  let path='';
  let open=false;
  values.forEach((value,index)=>{
    if(value==null){open=false;return;}
    const left=index*slot,right=left+slot,level=y(value);
    path+=open?` V${level} H${right}`:`${path?' ':''}M${left} ${level} H${right}`;
    open=true;
  });
  return path;
}

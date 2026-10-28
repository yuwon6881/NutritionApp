/** Drawn horizontal span for an accepted target interval, showing a stub when start and end clamp to the same point. */
export function acceptedLineSpan(x1:number,x2:number,left:number,stub=28):[number,number]{
  if(x1===x2)return [Math.max(left,x2-stub),x2];
  return [x1,x2];
}

/** Keeps points whose dates fall within [start, end] inclusive, ignoring missing bounds. */
export function filterPointsToRange<T extends {date:string}>(points:readonly T[],start?:string,end?:string):T[]{
  return points.filter(point=>(!start||point.date>=start)&&(!end||point.date<=end));
}

/** Nearest point in sorted chart positions; distance and duplicate ties go to the earlier point. */
export function nearestIndex(positions:readonly number[],x:number):number{
  if(!positions.length)return -1;
  let low=0,high=positions.length;
  while(low<high){const mid=(low+high)>>>1;if(positions[mid]<x)low=mid+1;else high=mid;}
  if(low===0)return 0;
  const selected=low===positions.length||x-positions[low-1]<=positions[low]-x?low-1:low;
  const value=positions[selected];
  high=selected;low=0;
  while(low<high){const mid=(low+high)>>>1;if(positions[mid]<value)low=mid+1;else high=mid;}
  return low;
}

/** Arrow-key stepping that stays inside the series; Home and End jump to its ends. */
export function steppedIndex(index:number,key:string,count:number):number|null{
  if(!count)return null;
  if(key==='ArrowLeft')return Math.max(0,index-1);
  if(key==='ArrowRight')return Math.min(count-1,index+1);
  if(key==='Home')return 0;
  if(key==='End')return count-1;
  return null;
}

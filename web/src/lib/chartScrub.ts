/** Index of the point whose x position is closest to `x`; ties go to the earlier point. */
export function nearestIndex(positions:readonly number[],x:number):number{
  let best=-1;
  let bestDistance=Infinity;
  positions.forEach((position,index)=>{
    const distance=Math.abs(position-x);
    if(distance<bestDistance){best=index;bestDistance=distance;}
  });
  return best;
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

export interface Rect {left:number;top:number;width:number;height:number}

/** Map a frame over centered object-fit: cover video back into source pixels. */
export function barcodeCrop(sourceWidth:number,sourceHeight:number,view:Rect,frame:Rect){
  if(sourceWidth<=0||sourceHeight<=0||view.width<=0||view.height<=0)return null;
  const scale=Math.max(view.width/sourceWidth,view.height/sourceHeight);
  const offsetX=(sourceWidth*scale-view.width)/2;
  const offsetY=(sourceHeight*scale-view.height)/2;
  const x=Math.max(0,(frame.left-view.left+offsetX)/scale);
  const y=Math.max(0,(frame.top-view.top+offsetY)/scale);
  const right=Math.min(sourceWidth,(frame.left+frame.width-view.left+offsetX)/scale);
  const bottom=Math.min(sourceHeight,(frame.top+frame.height-view.top+offsetY)/scale);
  if(right<=x||bottom<=y)return null;
  return {x,y,width:right-x,height:bottom-y};
}

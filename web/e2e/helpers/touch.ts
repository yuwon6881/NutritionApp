import type {Locator,Page} from '@playwright/test';

/**
 * Real touch input through the Chrome DevTools Protocol. Playwright's
 * touchscreen API only taps; press-and-hold, drags, and swipes need raw
 * touch events so pointer events report pointerType "touch".
 */
type Point={x:number;y:number};

async function centerOf(target:Locator):Promise<Point>{
  // Raw touch events use viewport coordinates and hit whatever is on top, so
  // centre the target clear of the fixed app bar and bottom navigation.
  await target.evaluate(element=>element.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));
  const box=await target.boundingBox();
  if(!box)throw new Error('Touch target is not visible.');
  return {x:box.x+box.width/2,y:box.y+box.height/2};
}

async function withTouch<T>(page:Page,action:(send:(type:'touchStart'|'touchMove'|'touchEnd',point?:Point)=>Promise<void>)=>Promise<T>){
  const session=await page.context().newCDPSession(page);
  try{
    return await action(async(type,point)=>{
      await session.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{x:Math.round(point.x),y:Math.round(point.y)}]:[]});
    });
  }finally{await session.detach();}
}

/** Steps between two points so move handlers see a continuous path. */
async function travel(send:(type:'touchMove',point:Point)=>Promise<void>,from:Point,to:Point,steps:number){
  for(let step=1;step<=steps;step++){
    await send('touchMove',{x:from.x+(to.x-from.x)*step/steps,y:from.y+(to.y-from.y)*step/steps});
  }
}

export async function longPress(page:Page,target:Locator,holdMs=600){
  const point=await centerOf(target);
  await withTouch(page,async send=>{
    await send('touchStart',point);
    await page.waitForTimeout(holdMs);
    await send('touchEnd');
  });
}

/** Press, hold until the card lifts, then drag to a point and release. */
export async function holdAndDrag(page:Page,target:Locator,to:Point,holdMs=600){
  const from=await centerOf(target);
  await withTouch(page,async send=>{
    await send('touchStart',from);
    await page.waitForTimeout(holdMs);
    await travel(send,from,to,12);
    await page.waitForTimeout(50);
    await send('touchEnd');
  });
}

/** A quick finger flick with no hold, as when scrolling. */
export async function swipe(page:Page,from:Point,to:Point){
  await withTouch(page,async send=>{
    await send('touchStart',from);
    await travel(send,from,to,8);
    await send('touchEnd');
  });
}

export {centerOf};

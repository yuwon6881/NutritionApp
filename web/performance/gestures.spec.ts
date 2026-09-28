import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {performanceFixture} from './fixtures';

test('frame intervals during repeated mobile card swipes',async({page,context,browser})=>{
  const fixture=performanceFixture(7);
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/me')return route.fulfill({json:{id:fixture.state.id,displayName:'Performance'}});
    if(path==='/api/bootstrap')return route.fulfill({json:fixture.state});
    if(path==='/api/diary')return route.fulfill({json:{entries:fixture.state.entries,days:fixture.state.days,revision:1,from:fixture.state.end,to:fixture.state.end,detailDays:90}});
    return route.fulfill({json:{status:'disconnected',days:[],summaries:[],workoutConnected:false,configured:false}});
  });
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const runs=[];
  for(let run=0;run<25;run++){
    if(run<5)await cdp.send('Network.clearBrowserCache');
    await page.goto('/');
    await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Food Log',exact:true}).click();
    const card=page.locator('.food-time-card').first();
    await expect(card).toBeVisible();
    const intervals=await card.evaluate(async element=>{
      const rect=element.getBoundingClientRect();
      const startX=rect.right-24,y=rect.top+rect.height/2;
      const send=(type:string,x:number)=>element.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch',button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y}));
      send('pointerdown',startX);
      const intervals:number[]=[];let previous:number|undefined;
      for(let frame=0;frame<30;frame++){
        const now=await new Promise<number>(resolve=>requestAnimationFrame(resolve));
        if(previous!==undefined)intervals.push(now-previous);
        previous=now;
        // Multiple samples in a frame exercise coalescing while final release remains exact.
        for(let sample=0;sample<4;sample++)send('pointermove',startX-(frame*4+sample)*1.5);
      }
      send('pointerup',startX-180);
      return intervals;
    });
    await expect(page.locator('.food-card-swipe').first()).toHaveAttribute('data-revealed','true');
    runs.push({run,kind:run<5?'cold-cache':'warm',intervals});
  }
  const warm=runs.slice(5).flatMap(run=>run.intervals);
  const within20Ms=warm.filter(interval=>interval<=20).length/warm.length;
  mkdirSync('artifacts/performance',{recursive:true});
  writeFileSync('artifacts/performance/gestures.json',JSON.stringify({browser:browser.version(),cpuThrottle:4,input:'synthetic touch pointer events',within20Ms,runs},null,2));
  console.log(JSON.stringify({gestureFramesWithin20Ms:within20Ms}));
});

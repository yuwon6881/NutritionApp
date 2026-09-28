import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {performanceFixture} from './fixtures';
import {prepare} from './prepare';

for(const days of [7,365,3650])test(`mobile performance ${days} days`,async({page,context,browser},info)=>{
  const fixture=performanceFixture(days,Number(process.env.NUTRITION_PERFORMANCE_OUTBOX??0));
  await prepare(page,fixture);
  const requests:Record<string,number>={};
  let transferredBytes=0;
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/'))requests[path]=(requests[path]??0)+1;});
  page.on('response',response=>{const length=Number(response.headers()['content-length']);if(Number.isFinite(length))transferredBytes+=length;});
  const cdp=await context.newCDPSession(page);
  let encodedNetworkBytes=0;
  await cdp.send('Network.enable');
  cdp.on('Network.loadingFinished',event=>{encodedNetworkBytes+=event.encodedDataLength;});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const runs=[];
  for(let run=0;run<25;run++) {
    if(run<5)await cdp.send('Network.clearBrowserCache');
    await page.reload();
    await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
    const startup=await page.evaluate(()=>performance.now());
    const navigation=await page.evaluate(()=>new Promise<number>(resolve=>{
      const started=performance.now();
      (document.querySelector('.nav-mobile-items [data-selection-key="food"]') as HTMLButtonElement).click();
      requestAnimationFrame(()=>resolve(performance.now()-started));
    }));
    await expect(page.getByRole('heading',{name:'Food Log',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Add entry',exact:true}).click();
    await page.getByRole('button',{name:/Log weight/}).click();
    await page.getByLabel('Weight (kg)',{exact:true}).fill(String(80+(run%3)*.1));
    const save=await page.evaluate(()=>new Promise<number>(resolve=>{
      const started=performance.now();
      const form=document.querySelector<HTMLFormElement>('.dialog-form')!;
      const observer=new MutationObserver(()=>{
        if(!document.querySelector('.dialog-form')){observer.disconnect();resolve(performance.now()-started);}
      });
      observer.observe(document.body,{childList:true,subtree:true});
      form.requestSubmit();
    }));
    const details=await page.evaluate(()=>{
      const entries=(window as unknown as {nutritionBenchmark:{kind:string;duration:number;store?:string}[]}).nutritionBenchmark;
      return {entries,memory:(performance as Performance&{memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize};
    });
    runs.push({run,kind:run<5?'cold-cache':'warm',startup,navigation,save,...details});
  }
  mkdirSync('artifacts/performance',{recursive:true});
  const label=process.env.NUTRITION_PERFORMANCE_LABEL??'current';
  const report={label,days,outbox:fixture.queue.length,browser:browser.version(),viewport:info.project.use.viewport,cpuThrottle:4,requests,transferredBytes,encodedNetworkBytes,runs};
  writeFileSync(`artifacts/performance/mobile-${days}-${label}.json`,JSON.stringify(report,null,2));
  const p95=(key:'startup'|'navigation'|'save')=>{const values=runs.slice(5).map(run=>run[key]).sort((a,b)=>a-b);return Math.round(values[18]);};
  console.log(JSON.stringify({days,p95Ms:{startup:p95('startup'),navigation:p95('navigation'),save:p95('save')},requests}));
});

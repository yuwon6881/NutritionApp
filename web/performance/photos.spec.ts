import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {performanceFixture} from './fixtures';
import {prepare} from './prepare';

test('mobile photo preparation stays asynchronous',async({page,context,browser})=>{
  await prepare(page,performanceFixture(7));
  // Deterministic synthetic 6 MP PNG; no private photos or provider calls.
  const png=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');
    canvas.width=3000;canvas.height=2000;
    const drawing=canvas.getContext('2d')!;
    const pixels=drawing.createImageData(canvas.width,canvas.height);
    let seed=12345;
    for(let index=0;index<pixels.data.length;index+=4){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const shade=seed>>>24;
      pixels.data[index]=shade;pixels.data[index+1]=shade;pixels.data[index+2]=shade;pixels.data[index+3]=255;
    }
    drawing.putImageData(pixels,0,0);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    return await new Promise<string>(resolve=>{
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);
    });
  });
  const file={name:'synthetic-6mp.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const runs=[];
  for(let run=0;run<25;run++){
    if(run<5)await cdp.send('Network.clearBrowserCache');
    await page.reload();
    await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Add entry',exact:true}).click();
    await page.getByRole('button',{name:'Scan food or label',exact:true}).click();
    await page.getByRole('button',{name:'AI logging',exact:true}).click();
    await page.getByRole('button',{name:'Meal photo',exact:true}).click();
    await page.evaluate(()=>{
      Object.assign(window,{photoFrameIntervals:[],photoFramePrevious:undefined,photoFrameActive:true});
      const sample=(now:number)=>{
        const state=window as unknown as {photoFrameIntervals:number[];photoFramePrevious?:number;photoFrameActive:boolean};
        if(!state.photoFrameActive)return;
        if(state.photoFramePrevious!==undefined)state.photoFrameIntervals.push(now-state.photoFramePrevious);
        state.photoFramePrevious=now;requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect.poll(()=>page.evaluate(()=>performance.getEntriesByName('nutrition:photo.prepare').length)).toBeGreaterThan(0);
    const result=await page.evaluate(()=>{
      const state=window as unknown as {photoFrameIntervals:number[];photoFrameActive:boolean};
      state.photoFrameActive=false;
      return {duration:performance.getEntriesByName('nutrition:photo.prepare').at(-1)!.duration,intervals:state.photoFrameIntervals};
    });
    await expect(page.getByRole('button',{name:'Estimate my meal',exact:true})).toBeEnabled();
    runs.push({run,kind:run<5?'cold-cache':'warm',...result});
  }
  const durations=runs.slice(5).map(run=>run.duration).sort((a,b)=>a-b);
  mkdirSync('artifacts/performance',{recursive:true});
  writeFileSync('artifacts/performance/photos.json',JSON.stringify({browser:browser.version(),cpuThrottle:4,inputBytes:file.buffer.length,dimensions:[3000,2000],runs},null,2));
  console.log(JSON.stringify({photoPreparationP95Ms:durations[18]}));
});

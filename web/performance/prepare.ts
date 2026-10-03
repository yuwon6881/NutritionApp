import type {Page} from '@playwright/test';
import {expect} from '@playwright/test';
import type {LocalData} from '../src/types';
import {performanceSummary} from './fixtures';

export async function prepare(page:Page,data:LocalData) {
  await page.addInitScript(()=>{
    Object.assign(window,{__NUTRITION_PERFORMANCE__:true});
    const samples:{kind:string;duration:number;store?:string}[]=[];
    Object.assign(window,{nutritionBenchmark:samples});
    new PerformanceObserver(list=>{for(const entry of list.getEntries())samples.push({kind:entry.entryType==='measure'?entry.name:'longtask',duration:entry.duration});})
      .observe({entryTypes:['measure','longtask']});
    const original=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){
      const started=performance.now();
      const transaction=original.apply(this,args);
      if(args[1]==='readwrite')transaction.addEventListener('complete',()=>samples.push({kind:'storage.write',store:[...transaction.objectStoreNames].join(','),duration:performance.now()-started}));
      return transaction;
    };
  });
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const state=data.state;
    if(path==='/api/auth/me')return route.fulfill({json:{id:state.id,displayName:state.displayName}});
    if(path==='/api/bootstrap')return route.fulfill({json:state,headers:{ETag:'"performance"'}});
    if(path==='/api/revisions')return route.fulfill({status:304,headers:{ETag:'"performance"'}});
    if(path==='/api/foods')return route.fulfill({json:{foods:state.foods,revision:1,foodRevision:1}});
    if(path==='/api/diary')return route.fulfill({json:{from:state.start,to:state.end,revision:1,detailCutoff:state.start,detailDays:90,entries:state.entries,days:state.days}});
    if(path==='/api/progress/summary')return route.fulfill({json:performanceSummary(state),headers:{ETag:'"progress"'}});
    if(path==='/api/training/summary')return route.fulfill({json:{summaries:[],workoutConnected:false}});
    if(path==='/api/sync')return route.fulfill({status:503,json:{message:'Benchmark retains local work.'}});
    if(path.includes('google-health'))return route.fulfill({json:{connected:false}});
    return route.fulfill({json:{configured:false,connected:false,subscriptions:[],enabled:false}});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.evaluate(async value=>{
    localStorage.setItem('nutrition-account',value.state.id);
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('nutrition-local');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['accounts','mutations','drafts','saved_foods','meta'],'readwrite');
      tx.objectStore('accounts').put(value,value.state.id);
      tx.objectStore('mutations').put({queue:value.queue},value.state.id);
      tx.objectStore('drafts').put({photoDrafts:value.photoDrafts,bodyDrafts:value.bodyDrafts},value.state.id);
      tx.objectStore('saved_foods').put({foods:value.state.foods,revision:1,loaded:true},value.state.id);
      tx.objectStore('meta').put(true,`migrated_v2:${value.state.id}`);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
    });
    db.close();
  },data);
}

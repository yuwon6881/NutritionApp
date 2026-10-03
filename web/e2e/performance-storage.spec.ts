import {test,expect} from '@playwright/test';
import {performanceFixture,performanceSummary} from '../performance/fixtures';

test('legacy food compaction preserves authoritative emptiness and unsynced work across offline restart',async({page,context})=>{
  const fixture=performanceFixture(7);
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/me')return route.fulfill({json:{id:fixture.state.id,displayName:'Performance'}});
    if(path==='/api/bootstrap')return route.fulfill({json:fixture.state});
    if(path==='/api/sync')return route.fulfill({status:503,json:{message:'Retain this edit.'}});
    return route.fulfill({json:{configured:false,status:'disconnected',days:[],summaries:[],workoutConnected:false}});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.evaluate(async value=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('nutrition-local');request.onsuccess=()=>resolve(request.result);});
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['accounts','mutations','drafts','saved_foods','meta'],'readwrite');
      tx.objectStore('accounts').put(value,value.state.id);
      tx.objectStore('saved_foods').put({foods:[],revision:1,loaded:true,fetchedAt:Date.now()},value.state.id);
      tx.objectStore('mutations').put({queue:[{id:'pending-weight',kind:'weight',recordId:'offline-weight',expectedRevision:0,delete:false,
        data:{date:value.state.end,kg:83},error:'Retained conflict'}]},value.state.id);
      tx.objectStore('drafts').put({photoDrafts:[{id:'retained',date:value.state.end,photos:[{id:'photo',angle:'front',imageBase64:'retained-image'}],error:'Review retained photo'}]},value.state.id);
      tx.objectStore('meta').delete(`migrated_v2:${value.state.id}`);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
    });
    localStorage.setItem('nutrition-account',value.state.id);db.close();
  },fixture);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  const stored=await page.evaluate(async account=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('nutrition-local');request.onsuccess=()=>resolve(request.result);});
    const records=await Promise.all(['accounts','saved_foods','mutations','drafts'].map(store=>new Promise<unknown>(resolve=>{
      const request=db.transaction(store,'readonly').objectStore(store).get(account);request.onsuccess=()=>resolve(request.result);
    })));
    db.close();return records;
  },fixture.state.id);
  expect(stored[0]).toMatchObject({state:{foods:[]}});
  expect(stored[1]).toMatchObject({foods:[],loaded:true});
  expect(stored[2]).toMatchObject({queue:[{id:'pending-weight'}]});
  expect(stored[3]).toMatchObject({photoDrafts:[{id:'retained',photos:[{imageBase64:'retained-image'}]}]});
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add entry',exact:true}).last()).toBeEnabled();
});

test('queued weigh-ins project locally without another Progress request',async({page})=>{
  const fixture=performanceFixture(7);
  let progressReads=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/me')return route.fulfill({json:{id:fixture.state.id,displayName:'Performance'}});
    if(path==='/api/bootstrap')return route.fulfill({json:fixture.state});
    if(path==='/api/progress/summary'){progressReads++;return route.fulfill({json:performanceSummary(fixture.state),headers:{ETag:'"summary"'}});}
    if(path==='/api/sync')return route.fulfill({status:503,json:{message:'Retain this edit.'}});
    return route.fulfill({json:{configured:false,status:'disconnected',days:[],summaries:[],workoutConnected:false}});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Progress',exact:true})).toBeVisible();
  await expect.poll(()=>progressReads).toBe(1);
  await page.getByRole('button',{name:'Add entry',exact:true}).last().click();
  await page.getByRole('button',{name:/Log weight/}).click();
  await page.getByLabel('Weight (kg)',{exact:true}).fill('80.2');
  await page.getByRole('button',{name:/Update weigh-in|Save weigh-in/,exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Log weight',exact:true})).not.toBeVisible();
  await expect(page.getByText('Recent edits will update after sync.')).toBeVisible();
  expect(progressReads).toBe(1);
});

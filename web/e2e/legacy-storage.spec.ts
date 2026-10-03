import {test,expect} from '@playwright/test';
import {performanceFixture} from '../performance/fixtures';

const STORES=['accounts','diary_days','saved_foods','mutations','drafts','meta','food_drafts','food_scans','push_revocations','push_devices'];

test('an installation from before the rename keeps its session, settings, and unsynced work',async({page})=>{
  const fixture=performanceFixture(7);
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/me')return route.fulfill({json:{id:fixture.state.id,displayName:'Performance'}});
    if(path==='/api/bootstrap')return route.fulfill({json:fixture.state});
    if(path==='/api/sync')return route.fulfill({status:503,json:{message:'Retain this edit.'}});
    return route.fulfill({json:{configured:false,status:'disconnected',days:[],summaries:[],workoutConnected:false}});
  });

  // A same-origin static file: storage can be seeded before the app has opened anything.
  await page.goto('/theme-boot.js');
  await page.evaluate(async({value,stores})=>{
    for(const key of Object.keys(localStorage))if(key.startsWith('nutrition-'))localStorage.removeItem(key);
    localStorage.setItem('nourish-account',value.state.id);
    localStorage.setItem('nourish-theme','dark');
    localStorage.setItem('nourish-push-device-id','device-before-rename');
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('nourish-local',5);
      request.onupgradeneeded=()=>{for(const store of stores)request.result.createObjectStore(store);};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['accounts','saved_foods','mutations','drafts','meta'],'readwrite');
      tx.objectStore('accounts').put(value,value.state.id);
      tx.objectStore('saved_foods').put({foods:[],revision:1,loaded:true,fetchedAt:Date.now()},value.state.id);
      tx.objectStore('mutations').put({queue:[{id:'pending-weight',kind:'weight',recordId:'offline-weight',expectedRevision:0,delete:false,
        data:{date:value.state.end,kg:83},error:'Retained conflict'}]},value.state.id);
      tx.objectStore('drafts').put({photoDrafts:[{id:'retained',date:value.state.end,photos:[{id:'photo',angle:'front',imageBase64:'retained-image'}],error:'Review retained photo'}]},value.state.id);
      tx.objectStore('meta').put(true,`migrated_v2:${value.state.id}`);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
    });
    db.close();
  },{value:fixture,stores:STORES});

  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');

  const keys=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>/^(nourish|nutrition)-/.test(key)).map(key=>[key,localStorage.getItem(key)])));
  expect(keys).toMatchObject({'nutrition-account':fixture.state.id,'nutrition-theme':'dark','nutrition-push-device-id':'device-before-rename'});
  expect(Object.keys(keys).filter(key=>key.startsWith('nourish-'))).toEqual([]);

  const stored=await page.evaluate(async account=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('nutrition-local');request.onsuccess=()=>resolve(request.result);});
    const read=(store:string,key:string)=>new Promise<unknown>(resolve=>{
      const request=db.transaction(store,'readonly').objectStore(store).get(key);request.onsuccess=()=>resolve(request.result);
    });
    const records=await Promise.all([read('mutations',account),read('drafts',account),read('meta','legacy-database-import')]);
    db.close();return records;
  },fixture.state.id);
  expect(stored[0]).toMatchObject({queue:[{id:'pending-weight'}]});
  expect(stored[1]).toMatchObject({photoDrafts:[{id:'retained',photos:[{imageBase64:'retained-image'}]}]});
  expect(stored[2]).toBe('done');

  await expect.poll(()=>page.evaluate(async()=>(await indexedDB.databases()).map(entry=>entry.name).sort())).toEqual(['nutrition-local']);
});

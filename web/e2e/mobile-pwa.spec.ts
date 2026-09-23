import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signIn} from './signIn';

async function signInWithProfile(page:import('@playwright/test').Page){
  await signIn(page);
  const state=await (await page.request.get('/api/state')).json();
  if(!state.profile){
    const response=await page.request.post('/api/sync',{
      headers:{Origin:new URL(page.url()).origin,'X-Nutrition-Request':'1'},
      data:{
        id:randomUUID(),kind:'profile',recordId:state.id,expectedRevision:0,delete:false,
        data:{dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0}
      }
    });
    expect(response.ok(),await response.text()).toBeTruthy();
    await page.reload();
  }
  await expect(page.getByRole('button',{name:'Settings',exact:true}).first()).toBeEnabled();
}

async function savePushCredential(page:import('@playwright/test').Page,userId:string){
  await page.evaluate(async accountId=>{
    const deviceId='pwa-signout-test-device';
    localStorage.setItem('nourish-push-device-id',deviceId);
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('nourish-local');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('push_devices','readwrite');
      tx.objectStore('push_devices').put({version:1,userId:accountId,deviceId,fcmToken:'test-fcm-token',updatedAt:Date.now()},`${accountId}:${deviceId}`);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
    db.close();
  },userId);
}

test('Settings renders without mobile app and offline data area',async({page})=>{
  await signInWithProfile(page);
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();

  const readiness=page.getByRole('region',{name:'Mobile app and offline data'});
  await expect(readiness).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Fitness Account'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Local Nutrition data'})).toBeVisible();
});

test('failed push revocation does not block sign-out and runs before session logout',async({page})=>{
  await signInWithProfile(page);
  const state=await (await page.request.get('/api/state')).json();
  await savePushCredential(page,state.id);
  const requests:string[]=[];
  await page.route('**/api/notifications/subscriptions/**',async route=>{
    if(route.request().method()==='DELETE'){
      requests.push('revoke');
      await route.fulfill({status:503,json:{message:'Temporarily unavailable.'}});
      return;
    }
    await route.continue();
  });
  await page.route('**/api/auth/logout',async route=>{
    requests.push('logout');
    await route.fulfill({status:204});
  });

  await page.getByRole('button',{name:'Settings',exact:true}).first().click();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();

  await expect(page.getByRole('button',{name:'Sign in with Fitness Account',exact:true})).toBeVisible();
  expect(requests).toEqual(['revoke','logout']);
  const queued=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('nourish-local');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    const records=await new Promise<{userId:string;deviceId:string;fcmToken:string}[]>((resolve,reject)=>{
      const request=db.transaction('push_revocations','readonly').objectStore('push_revocations').getAll();
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    db.close();
    return records.map(record=>({userId:record.userId,deviceId:record.deviceId,fcmToken:record.fcmToken}));
  });
  expect(queued).toEqual([{userId:state.id,deviceId:'pwa-signout-test-device',fcmToken:'test-fcm-token'}]);
});

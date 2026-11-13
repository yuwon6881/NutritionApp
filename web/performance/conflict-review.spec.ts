import {expect,test,type Page} from '@playwright/test';
import type {Mutation} from '../src/types';
import {performanceFixture} from './fixtures';
import {prepare} from './prepare';

async function retained(page:Page){
  return page.evaluate(()=>new Promise<{queue:unknown[];conflicts:unknown[]}>(resolve=>{
    const opening=indexedDB.open('nutrition-local');
    opening.onsuccess=()=>{
      const db=opening.result;
      const request=db.transaction('mutations').objectStore('mutations').get('performance-account');
      request.onsuccess=()=>{db.close();resolve(request.result??{queue:[],conflicts:[]});};
      request.onerror=()=>{db.close();resolve({queue:[],conflicts:[]});};
    };
    opening.onerror=()=>resolve({queue:[],conflicts:[]});
  }));
}

test('a 409 stays available for review while later queue entries are processed and bulk resolved',async({page})=>{
  const fixture=performanceFixture(7);
  fixture.queue=[0,1].map(index=>({id:`mutation-${index}`,kind:'weight',recordId:`weight-${index}`,expectedRevision:1,delete:false,
    data:{date:fixture.state.weights[index].date,kg:81}} as Mutation));
  await prepare(page,fixture);
  let requests=0;
  await page.route('**/api/sync',route=>{requests++;return route.fulfill({status:409,json:{message:'This record conflicts with saved data.'}});});
  await page.reload();

  await expect(page.getByRole('button',{name:'Review 2 changes',exact:true})).toBeVisible();
  await expect.poll(()=>requests).toBe(2);
  await expect.poll(async()=>{
    const partition=await retained(page);
    return [partition.queue.length,partition.conflicts.length];
  }).toEqual([0,2]);

  await page.getByRole('button',{name:'Review 2 changes',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Review sync conflicts'});
  await expect(dialog.getByRole('heading',{name:'Weigh-in change'})).toHaveCount(2);
  await dialog.getByRole('button',{name:'Resolve all 2 changes',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('removes all 2 unsent edits');
  await dialog.getByRole('button',{name:'Keep saved version for all',exact:true}).click();
  await expect(dialog.getByText('All changes have been reviewed. Your saved diary remains unchanged.')).toBeVisible();
  await expect.poll(async()=>{
    const partition=await retained(page);
    return partition.conflicts.length;
  }).toBe(0);
  expect(requests).toBe(2);
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
});

test('legacy conflict markers migrate out of dispatch without another request',async({page})=>{
  const fixture=performanceFixture(7);
  fixture.queue=[{id:'legacy-conflict',kind:'weight',recordId:'weight-0',expectedRevision:1,delete:false,
    data:{date:fixture.state.weights[0].date,kg:81},error:'Retained conflict'} as Mutation];
  await prepare(page,fixture);
  let requests=0;
  await page.route('**/api/sync',route=>{requests++;return route.fulfill({status:409,json:{message:'This record conflicts with saved data.'}});});
  await page.reload();

  await expect(page.getByRole('button',{name:'Review 1 change',exact:true})).toBeVisible();
  await expect.poll(async()=>{
    const partition=await retained(page);
    return [partition.queue.length,partition.conflicts.length];
  }).toEqual([0,1]);
  expect(requests).toBe(0);
});
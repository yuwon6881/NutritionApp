import {test,expect,type Page} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';
async function weight(page:Page,value:string){
  await page.getByRole('button',{name:'Add entry',exact:true}).last().click();
  await page.getByRole('dialog',{name:'Add',exact:true}).getByRole('button',{name:'Log weight',exact:true}).click();
  await page.getByLabel('Weight (kg)',{exact:true}).fill(value);
  await page.getByRole('button',{name:/Update weigh-in|Save weigh-in/,exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Log weight',exact:true})).not.toBeVisible();
}
async function queueCount(page:Page){return page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('nutrition-local');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise<number>((resolve,reject)=>{const r=db.transaction('mutations').objectStore('mutations').getAll();r.onsuccess=()=>resolve(r.result.reduce((n,row)=>n+(row.queue?.length??0),0));r.onerror=()=>reject(r.error);});}finally{db.close();}
});}
test('two tabs retain offline edits across reload and drain both edits after reconnect',async({request,context,page})=>{
  const session=await seedMobileUser(request,'two-tab-retained',[]);await context.addCookies(session.cookies);
  await page.goto('/');await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  const second=await context.newPage();await second.goto('/');await expect(second.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await context.setOffline(true);await weight(page,'81');await weight(second,'82');
  await expect.poll(()=>queueCount(page)).toBe(2);
  await page.reload();await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect.poll(()=>queueCount(page)).toBe(2);
  await context.setOffline(false);await expect.poll(()=>queueCount(page),{timeout:30000}).toBe(0);
  await second.close();
});

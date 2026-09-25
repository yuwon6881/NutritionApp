import {expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from '../signIn';

export const testOrigin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:testOrigin,'X-Nutrition-Request':'1'};
const zone='Asia/Kuala_Lumpur';

export function todayInTestZone(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

export interface SeedEntry {name:string;time:string;calories:number}

/**
 * Resets the isolated development database and creates a user with an
 * accepted plan, recent weigh-ins, and today's food entries. Never point
 * this at production or a personal diary.
 */
export async function seedMobileUser(request:APIRequestContext,username:string,entries:SeedEntry[]){
  await request.post('/api/auth/dev-reset',{headers});
  const res=await signInApi(request,username);
  expect(res.ok()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const save=async(kind:string,data:unknown,recordId=randomUUID())=>{
    const response=await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId,expectedRevision:0,delete:false,data}});
    expect(response.ok()).toBeTruthy();
  };
  await save('profile',{dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:zone,phaseMode:'open',energyAdjustmentPercent:0},state.id);
  const preview=await (await request.get('/api/coach/preview')).json();
  await request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}});
  const current=todayInTestZone();
  for(let offset=6;offset>=0;offset--){
    const day=new Date(`${current}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-offset);
    const date=day.toISOString().slice(0,10);
    await save('weight',{date,kg:80.5+offset*.1});
    // Past days with food keep the missed-day prompt from covering the page.
    if(offset>0)await save('entry',{date,name:'Porridge',calories:350,protein:12,carbs:55,fat:8,fiber:6,quantity:1,unit:'serving',time:'07:00'});
  }
  for(const entry of entries){
    await save('entry',{date:current,name:entry.name,calories:entry.calories,protein:10,carbs:20,fat:5,fiber:2,quantity:1,unit:'serving',time:entry.time});
  }
  return request.storageState();
}

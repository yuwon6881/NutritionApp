import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from './signIn';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;
let todayDate='';

function shift(date:string,days:number){
  const [year,month,day]=date.split('-').map(Number);
  return new Date(Date.UTC(year,month-1,day+days)).toISOString().slice(0,10);
}

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const signedIn=await signInApi(request,'test-weight-context');
  expect(signedIn.ok(),await signedIn.text()).toBeTruthy();
  let state=await (await request.get('/api/state')).json();
  const saved=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,delete:false,
    data:{age:30,dateOfBirth:'1996-03-14',heightCm:170,weightKg:80,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,
      proteinGrams:null,resistanceTraining:false,pregnancyOrBreastfeeding:false,medicalNutrition:false,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open'},
  }});
  expect(saved.ok(),await saved.text()).toBeTruthy();
  state=await (await request.get('/api/state')).json();
  todayDate=state.end;
  for(const daysAgo of [3,2,1]){
    const weightDate=shift(todayDate,-daysAgo);
    const weight=await request.post('/api/sync',{headers,data:{
      id:randomUUID(),recordId:randomUUID(),kind:'weight',expectedRevision:0,delete:false,
      data:{date:weightDate,kg:80},
    }});
    expect(weight.ok(),await weight.text()).toBeTruthy();
    const day=await request.post('/api/sync',{headers,data:{
      id:randomUUID(),recordId:randomUUID(),kind:'day',expectedRevision:0,delete:false,
      data:{date:weightDate,status:'not_logged'},
    }});
    expect(day.ok(),await day.text()).toBeTruthy();
  }
  session=await request.storageState();
});

test('unusual weigh-ins collect an optional context and let the user revise it',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.goto('/');
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await page.getByRole('button',{name:'Add weigh-in',exact:true}).click();

  const dialog=page.getByRole('dialog',{name:'Log weight',exact:true});
  await dialog.getByLabel('Weight (kg)',{exact:true}).fill('82');
  await expect(dialog.getByRole('heading',{name:'This differs from your recent weigh-ins'})).toBeVisible();
  const contextChoice=dialog.getByRole('button',{name:'Choose possible temporary context'});
  await contextChoice.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(contextChoice).toHaveText('Stress');

  for(const width of [390,768,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});
    await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }

  await dialog.getByRole('button',{name:'Save weigh-in'}).click();
  const savedWeight=async()=>{
    const state=await (await context.request.get('/api/state')).json();
    return state.weights.find((weight:{date:string})=>weight.date===todayDate);
  };
  await expect.poll(savedWeight).toMatchObject({kg:82,context:'stress'});

  const row=page.locator('.weight-history .history-row').filter({hasText:todayDate});
  await expect(row.getByRole('button',{name:'Edit',exact:true})).toBeVisible();
  await row.getByRole('button',{name:'Edit',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'Edit weigh-in',exact:true});
  await edit.getByLabel('Weight (kg)',{exact:true}).fill('82.2');
  const editedChoice=edit.getByRole('button',{name:'Choose possible temporary context'});
  await expect(editedChoice).toHaveText('No context');
  await editedChoice.click();
  await page.getByRole('option',{name:'A genuine change',exact:true}).click();
  await expect(editedChoice).toHaveText('A genuine change');
  await edit.getByRole('button',{name:'Update weigh-in'}).click();
  await expect.poll(savedWeight).toMatchObject({kg:82.2,context:'genuine_change'});
});

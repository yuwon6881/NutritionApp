import {randomUUID} from 'node:crypto';
import {expect,test,type Page} from '@playwright/test';
import {signInApi} from './signIn';
import {ensureAcceptedPlan} from './helpers/acceptedPlan';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const yesterday=new Date(Date.parse(`${current}T00:00:00Z`)-86400000).toISOString().slice(0,10);

async function seed(page:Page){
  expect((await page.request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  expect((await signInApi(page.request,'test-alice')).ok()).toBeTruthy();
  const state=await (await page.request.get('/api/state')).json();
  expect((await page.request.post('/api/sync',{headers,data:{id:randomUUID(),kind:'profile',recordId:state.id,expectedRevision:state.profileRevision,delete:false,data:{dateOfBirth:'1996-03-14',age:30,heightCm:175,weightKg:80,sex:'male',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open'}}})).ok()).toBeTruthy();
  expect((await page.request.post('/api/sync',{headers,data:{id:randomUUID(),kind:'weight',recordId:randomUUID(),expectedRevision:0,delete:false,data:{date:yesterday,kg:80,context:null}}})).ok()).toBeTruthy();
  expect((await page.request.post('/api/sync',{headers,data:{id:randomUUID(),kind:'entry',recordId:randomUUID(),expectedRevision:0,delete:false,data:{date:yesterday,time:'08:00',name:'Breakfast only',calories:400,protein:20,carbs:50,fat:10,fiber:null,source:'manual',quantity:1,unit:'serving'}}})).ok()).toBeTruthy();
  await ensureAcceptedPlan(page.request);
}

for(const width of [390,1440])test(`a past day with food can be marked not fully logged at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await seed(page);
  await page.goto('/');
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await page.getByRole('group',{name:'Choose a food day'}).locator(`[data-date="${yesterday}"]`).click();
  const status=page.getByLabel('Logging status',{exact:true});
  await expect(status).toHaveValue('incomplete');
  await expect(status.locator('option[value="fasting"]')).toBeDisabled();
  await status.selectOption({label:'Not fully logged'});
  await expect(status).toHaveValue('not_logged');
  await expect.poll(async()=>{
    const state=await (await page.request.get('/api/state')).json();
    return state.days.find((day:{date:string;deleted:boolean})=>day.date===yesterday&&!day.deleted)?.status;
  }).toBe('not_logged');
  await expect(page.locator('.food-time-card').filter({hasText:'Breakfast only'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});

import {ensureAcceptedPlan} from './helpers/acceptedPlan';
import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from './signIn';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const response=await signInApi(request,'test-move-race');
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const saved=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,delete:false,data:{
      age:28,dateOfBirth:'1998-05-20',heightCm:175,weightKg:75,sex:'male',activity:1.4,goal:'maintain',maintenance:2600,
      proteinGrams:null,resistanceTraining:true,pregnancyOrBreastfeeding:false,medicalNutrition:false,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0,
    }
  }});
  expect(saved.ok(),await saved.text()).toBeTruthy();
  await ensureAcceptedPlan(request);
  session=await request.storageState();
});

test('bulk move issued while the batch that created those entries is still syncing clears its pending badges without a reload',async({page,context})=>{
  await context.addCookies(session.cookies);

  const held:Array<()=>void>=[];
  let holding=true;
  await page.route('**/api/sync',async route=>{
    const body=route.request().postDataJSON() as {kind?:string;expectedRevision?:number;delete?:boolean};
    if(holding&&body.kind==='entry'&&body.expectedRevision===0&&body.delete===false){
      await new Promise<void>(resolve=>held.push(resolve));
    }
    await route.continue();
  });

  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();

  // Log four foods in one batch (mirrors an AI photo estimate landing several items at once).
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();
  for(const [i,name] of ['Food A','Food B','Food C','Food D'].entries()){
    if(i>0)await page.getByRole('button',{name:'Add more food'}).click();
    await page.getByRole('button',{name:'Manual entry'}).click();
    await page.getByLabel('Food name',{exact:true}).fill(name);
    await page.getByLabel('Calories (kcal)',{exact:true}).fill('100');
    await page.getByLabel('Meal time',{exact:true}).fill('22:24');
    await page.getByRole('button',{name:'Add to batch',exact:true}).click();
  }
  await page.getByRole('button',{name:/^Log all 4 foods$/,exact:true}).click();
  await page.getByRole('button',{name:'Food Log',exact:true}).click();

  // The batch returns to the diary immediately; the four creates are held mid-flight.
  await expect(page.getByText('Food A',{exact:true})).toBeVisible();
  await expect(page.getByText('Food D',{exact:true})).toBeVisible();
  await expect(page.getByText('Pending sync').first()).toBeVisible();
  // Only the first create has reached the server yet (drain sends one at a time); later ones
  // haven't even been dispatched, so at most one held resolver exists right now - that's expected.

  // Select all four and move them to a new time while their own creation is still unsynced.
  await page.getByRole('button',{name:'Day options',exact:true}).click();
  await page.getByRole('menuitem',{name:'Bulk select',exact:true}).click();
  const row2224=page.locator('[data-time-row="22:24"]');
  for(const name of ['Food A','Food B','Food C','Food D']){
    await row2224.locator('.food-time-card').filter({hasText:name}).first().click();
  }
  const bar=page.getByRole('toolbar',{name:'Bulk selection actions'});
  await bar.getByRole('button',{name:'Move 4 selected foods',exact:true}).click();
  const moveDialog=page.getByRole('dialog',{name:'Move 4 entries'});
  await moveDialog.getByRole('button',{name:/Date and time/i}).click();
  await page.getByLabel('Move to time (optional)',{exact:true}).fill('17:00');
  await page.getByRole('button',{name:'Move',exact:true}).click();

  // Now let the held creates (and whatever follows) proceed through the real server.
  holding=false;
  while(held.length)held.shift()!();
  // A create blocked on a later one being released serially; pump a few more times.
  for(let i=0;i<8&&held.length===0;i++){await page.waitForTimeout(250);}
  while(held.length)held.shift()!();

  const row17=page.locator('[data-time-row="17:00"]');
  await expect(row17.getByText('Food A')).toBeVisible({timeout:15000});
  await expect(row17.getByText('Food B')).toBeVisible({timeout:15000});
  await expect(row17.getByText('Food C')).toBeVisible({timeout:15000});
  await expect(row17.getByText('Food D')).toBeVisible({timeout:15000});

  // The pending badge must clear on its own - no reload.
  await expect(page.getByText('Pending sync')).toHaveCount(0,{timeout:15000});
});

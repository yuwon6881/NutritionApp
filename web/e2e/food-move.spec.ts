import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const data={username:'test-move',password:'food move test password 2026'};
  let response=await request.post('/api/auth/login',{headers,data});
  for(let attempt=0;response.status()===429&&attempt<12;attempt++){
    await new Promise(resolve=>setTimeout(resolve,5000));
    response=await request.post('/api/auth/login',{headers,data});
  }
  if(response.status()===401){
    response=await request.post('/api/auth/register',{headers,data});
    for(let attempt=0;response.status()===429&&attempt<12;attempt++){
      await new Promise(resolve=>setTimeout(resolve,5000));
      response=await request.post('/api/auth/register',{headers,data});
    }
  }
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const saved=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,delete:false,data:{
      age:28,dateOfBirth:'1998-05-20',heightCm:175,weightKg:75,sex:'male',activity:1.4,goal:'maintain',maintenance:2600,
      proteinGrams:null,resistanceTraining:true,pregnancyOrBreastfeeding:false,medicalNutrition:false,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0,
    }
  }});
  expect(saved.ok(),await saved.text()).toBeTruthy();
  session=await request.storageState();
});

test('food timeline supports single-item move to custom time, move to existing time, and group move',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();

  // Log first entry: Oatmeal at 08:00
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();
  await page.getByRole('button',{name:'Manual entry'}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Rolled oats');
  await page.getByLabel('Calories (kcal)',{exact:true}).fill('380');
  await page.getByLabel('Protein (g)',{exact:true}).fill('13');
  await page.getByLabel('Meal time',{exact:true}).fill('08:00');
  await page.getByRole('button',{name:'Add to batch',exact:true}).click();await page.getByRole('button',{name:'Log all 1 food',exact:true}).click();await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('button',{name:'Rolled oats',exact:true})).toBeVisible();

  // Log second entry: Black coffee at 08:00
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();
  await page.getByRole('button',{name:'Manual entry'}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Black coffee');
  await page.getByLabel('Calories (kcal)',{exact:true}).fill('5');
  await page.getByLabel('Meal time',{exact:true}).fill('08:00');
  await page.getByRole('button',{name:'Add to batch',exact:true}).click();await page.getByRole('button',{name:'Log all 1 food',exact:true}).click();await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('button',{name:'Black coffee',exact:true})).toBeVisible();

  // Check that both items are grouped under 08:00
  const row08=page.locator('[data-time-row="08:00"]');
  await expect(row08).toBeVisible();
  await expect(row08.getByText('Rolled oats')).toBeVisible();
  await expect(row08.getByText('Black coffee')).toBeVisible();

  // Single move: open the MacroFactor-style entry action sheet and move Rolled oats to custom time 12:15
  const oatsAt08=row08.locator('.food-time-card').filter({hasText:'Rolled oats'}).first();
  await oatsAt08.getByRole('button',{name:'More actions for Rolled oats',exact:true}).click();
  await page.getByRole('dialog',{name:'Food actions'}).getByRole('button',{name:'Move to',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Move Rolled oats'})).toBeVisible();
  await page.getByLabel('Move to time (optional)',{exact:true}).fill('12:15');
  await page.getByRole('button',{name:'Move',exact:true}).click();

  // Verify Rolled oats is now under 12:15 and Black coffee remains at 08:00
  const row1215=page.locator('[data-time-row="12:15"]');
  await expect(row1215).toBeVisible();
  await expect(row1215.getByText('Rolled oats')).toBeVisible();
  await expect(row1215.getByText('380 kcal')).toBeVisible();
  await expect(row08.getByText('Black coffee')).toBeVisible();
  await expect(row08.getByText('Rolled oats')).toHaveCount(0);

  // Move Black coffee using the existing target button (12:15 PM)
  const coffeeAt08=row08.locator('.food-time-card').filter({hasText:'Black coffee'}).first();
  await coffeeAt08.getByRole('button',{name:'More actions for Black coffee',exact:true}).click();
  await page.getByRole('dialog',{name:'Food actions'}).getByRole('button',{name:'Move to',exact:true}).click();
  const moveDialog=page.getByRole('dialog',{name:'Move Black coffee'});
  await expect(moveDialog).toBeVisible();
  await moveDialog.getByRole('button',{name:/12:15 PM/}).click();

  // Both items are now under 12:15
  await expect(row1215.getByText('Rolled oats')).toBeVisible();
  await expect(row1215.getByText('Black coffee')).toBeVisible();

  // Group move: Move all items from 12:15 PM to 19:00
  await row1215.getByRole('button',{name:/Move all/,exact:false}).click();
  await expect(page.getByRole('heading',{name:'Move 2 entries'})).toBeVisible();
  await page.getByLabel('Move to time (optional)',{exact:true}).fill('19:00');
  await page.getByRole('button',{name:'Move',exact:true}).click();

  // Verify group moved to 19:00
  const row19=page.locator('[data-time-row="19:00"]');
  await expect(row19).toBeVisible();
  await expect(row19.getByText('Rolled oats')).toBeVisible();
  await expect(row19.getByText('Black coffee')).toBeVisible();

  // Reload page to verify persistence across reload
  await page.reload();
  await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  const reloaded19=page.locator('[data-time-row="19:00"]');
  await expect(reloaded19).toBeVisible();
  await expect(reloaded19.getByText('Rolled oats')).toBeVisible();
  await expect(reloaded19.getByText('Black coffee')).toBeVisible();

  // Copy creates an editable duplicate at a chosen time instead of silently duplicating in place.
  const reloadedOats=reloaded19.locator('.food-time-card').filter({hasText:'Rolled oats'}).first();
  await reloadedOats.getByRole('button',{name:'More actions for Rolled oats',exact:true}).click();
  await page.getByRole('dialog',{name:'Food actions'}).getByRole('button',{name:'Copy',exact:true}).click();
  const copyDialog=page.getByRole('dialog',{name:'Copy food'});
  await copyDialog.getByLabel('Copy to time (optional)',{exact:true}).fill('21:00');
  await copyDialog.getByRole('button',{name:'Copy',exact:true}).click();
  const row21=page.locator('[data-time-row="21:00"]');
  await expect(row21.getByText('Rolled oats')).toBeVisible();

  // Delete is explicit and confirmed before the retained entry mutation is queued.
  const reloadedCoffee=reloaded19.locator('.food-time-card').filter({hasText:'Black coffee'}).first();
  await reloadedCoffee.getByRole('button',{name:'More actions for Black coffee',exact:true}).click();
  await page.getByRole('dialog',{name:'Food actions'}).getByRole('button',{name:'Delete',exact:true}).click();
  const deleteDialog=page.getByRole('dialog',{name:'Delete food'});
  await expect(deleteDialog).toContainText('Black coffee');
  await deleteDialog.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(reloaded19.getByText('Black coffee')).toHaveCount(0);

  // The full diary is also available as its own page with visible hourly drop slots.
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Food Log',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Full day',exact:true}).click();
  await expect(page.locator('[data-time-row="20:00"]')).toBeVisible();

  // Pointer drag moves an entry directly onto an empty hour.
  const moving=page.locator('[data-time-row="19:00"] .food-time-card').filter({hasText:'Rolled oats'}).first();
  const target=page.locator('[data-time-row="20:00"]');
  await target.scrollIntoViewIfNeeded();
  const from=await moving.boundingBox();
  const to=await target.boundingBox();
  expect(from).not.toBeNull();expect(to).not.toBeNull();
  await page.mouse.move(from!.x+from!.width/2,from!.y+from!.height/2);
  await page.mouse.down();
  await page.mouse.move(to!.x+to!.width/2,to!.y+to!.height/2,{steps:6});
  await page.mouse.up();
  await expect(page.locator('[data-time-row="20:00"] .food-time-card')).toHaveCount(1);
  await expect(page.locator('[data-time-row="20:00"]')).toContainText('Rolled oats');

  // Move to supports a date and time destination as well as an hourly target.
  const copiedOats=page.locator('[data-time-row="21:00"] .food-time-card').filter({hasText:'Rolled oats'}).first();
  await copiedOats.getByRole('button',{name:'More actions for Rolled oats',exact:true}).click();
  await page.getByRole('dialog',{name:'Food actions'}).getByRole('button',{name:'Move to',exact:true}).click();
  const dateMoveDialog=page.getByRole('dialog',{name:'Move Rolled oats'});
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
  const yesterdayIso=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'}).format(yesterday);
  await dateMoveDialog.locator('#move-food-date').fill(yesterdayIso,{force:true});
  await dateMoveDialog.getByLabel('Move to time (optional)',{exact:true}).fill('21:30');
  await dateMoveDialog.getByRole('button',{name:'Move',exact:true}).click();
  await page.getByRole('button',{name:'Previous food day',exact:true}).click();
  await expect(page.locator('[data-time-row="21:30"]')).toContainText('Rolled oats');
});

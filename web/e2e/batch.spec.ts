import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const data={username:'test-batch',password:'batch test password 2026'};
  let response=await request.post('/api/auth/login',{headers,data});
  for(let attempt=0;response.status()===429&&attempt<12;attempt++){
    await new Promise(resolve=>setTimeout(resolve,5000));
    response=await request.post('/api/auth/login',{headers,data});
  }
  if(response.status()===401)response=await request.post('/api/auth/register',{headers,data});
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const saved=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,delete:false,data:{
      age:29,dateOfBirth:'1997-01-10',heightCm:180,weightKg:82,sex:'male',activity:1.5,goal:'maintain',maintenance:2700,
      proteinGrams:null,resistanceTraining:true,pregnancyOrBreastfeeding:false,medicalNutrition:false,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0,
    }
  }});
  expect(saved.ok(),await saved.text()).toBeTruthy();

  // Seed two saved custom foods
  const food1=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),recordId:randomUUID(),kind:'food',expectedRevision:0,delete:false,data:{
      name:'Greek Yogurt 0%',calories:59,protein:10,carbs:3.6,fat:0,fiber:0,servingGrams:100,favourite:true,source:'custom',ingredientsJson:'[]',cookedYieldGrams:null
    }
  }});
  expect(food1.ok(),await food1.text()).toBeTruthy();

  const food2=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),recordId:randomUUID(),kind:'food',expectedRevision:0,delete:false,data:{
      name:'Blueberries Fresh',calories:57,protein:0.7,carbs:14.5,fat:0.3,fiber:2.4,servingGrams:100,favourite:true,source:'custom',ingredientsJson:'[]',cookedYieldGrams:null
    }
  }});
  expect(food2.ok(),await food2.text()).toBeTruthy();

  session=await request.storageState();
});

test('batch multi-food logging: checkboxes, live totals rescaling, removal, atomic commit, and dirty close protection',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Diary'})).toBeVisible();

  // Open Log food modal
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();
  await expect(page.getByRole('heading',{name:'Log food'})).toBeVisible();

  // Search is the default tab; saved foods carry the batch checkboxes.
  await page.getByRole('button',{name:'Your foods',exact:true}).click();

  // Click Greek Yogurt row to review portion and add to batch
  await page.getByRole('button',{name:/Greek Yogurt 0%/}).click();
  await expect(page.getByRole('heading',{name:'Review food'})).toBeVisible();
  await page.getByRole('button',{name:'Add to batch'}).click();
  await expect(page.getByRole('heading',{name:'Batch (1 food)'})).toBeVisible();

  // Test dirty close protection with basket item
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Discard changes?'})).toBeVisible();

  // Keep editing keeps the dialog and basket intact
  await page.getByRole('button',{name:'Keep editing'}).click();
  await expect(page.getByRole('heading',{name:'Batch (1 food)'})).toBeVisible();

  // Add more food to return to selection
  await page.getByRole('button',{name:'Add more food'}).click();
  await page.getByRole('button',{name:'Your foods',exact:true}).click();

  // Click Blueberries Fresh row to review and add to batch
  await page.getByRole('button',{name:/Blueberries Fresh/}).click();
  await expect(page.getByRole('heading',{name:'Review food'})).toBeVisible();
  await page.getByRole('button',{name:'Add to batch'}).click();
  await expect(page.getByRole('heading',{name:'Batch (2 foods)'})).toBeVisible();

  // Live calorie card checks (59 + 57 = 116 kcal)
  const calorieCard=page.locator('.live-calorie-card');
  await expect(calorieCard).toBeVisible();
  await expect(calorieCard.getByText('116')).toBeVisible();
  await expect(calorieCard.getByText('2 foods')).toBeVisible();

  // Rescale quantity of Greek Yogurt from 100g to 200g (59 * 2 = 118 + 57 = 175 kcal)
  const qtyInput=page.locator('input[id*="basket-qty"]').first();
  await qtyInput.fill('200');
  await expect(calorieCard.getByText('175')).toBeVisible();

  // Remove Blueberries Fresh from batch
  await page.getByRole('button',{name:'Remove Blueberries Fresh'}).click();
  await expect(calorieCard.getByText('1 food')).toBeVisible();
  await expect(calorieCard.getByText('118')).toBeVisible();

  // Set the batch time to 15:30
  await page.getByLabel('Meal time',{exact:true}).fill('15:30');

  // Submit batch
  await page.getByRole('button',{name:/Log all 1 food/}).click();

  // Check that the entry appears in timeline at 15:30
  const row1530=page.locator('[data-time-row="15:30"]');
  await expect(row1530).toBeVisible();
  await expect(row1530.getByText('Greek Yogurt 0%')).toBeVisible();
  await expect(row1530.getByText('118 kcal')).toBeVisible();
});

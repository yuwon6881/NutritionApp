import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const credentials={username:'test-keyboard',password:'keyboard test password 2026'};
  let response=await request.post('/api/auth/register',{headers,data:credentials});
  for(let attempt=0;response.status()===429&&attempt<12;attempt++){
    await new Promise(resolve=>setTimeout(resolve,5000));
    response=await request.post('/api/auth/register',{headers,data:credentials});
  }
  expect(response.ok(),await response.text()).toBeTruthy();

  const state=await (await request.get('/api/state')).json();
  const profile=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,delete:false,data:{
      age:30,dateOfBirth:'1996-03-14',heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,
      proteinGrams:null,resistanceTraining:true,pregnancyOrBreastfeeding:false,medicalNutrition:false,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0,
    },
  }});
  expect(profile.ok(),await profile.text()).toBeTruthy();
  const preview=await (await request.get('/api/coach/preview')).json();
  const accepted=await request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}});
  expect(accepted.ok(),await accepted.text()).toBeTruthy();

  const food=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),recordId:randomUUID(),kind:'food',expectedRevision:0,delete:false,data:{
      name:'Keyboard saved food',calories:210,protein:12,carbs:24,fat:7,fiber:3,servingGrams:100,favourite:true,source:'custom',ingredientsJson:'[]',cookedYieldGrams:null,
    },
  }});
  expect(food.ok(),await food.text()).toBeTruthy();
  session=await request.storageState();
});

test('keyboard actions submit forms and activate only the focused control',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.route('**/api/foods/search*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([
    {name:'Keyboard nasi goreng',calories:81,protein:5.3,carbs:12.1,fat:0.6,fiber:null,source:'Open Food Facts / ODbL / 20422677',servingGrams:100},
  ])}));
  await page.goto('/');
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();

  const search=page.getByLabel('Search term',{exact:true});
  await search.fill('nasi goreng');
  await search.press('Enter');
  await expect(page.getByRole('heading',{name:'Log food',exact:true})).toBeVisible();
  await expect(page.getByText('Keyboard nasi goreng',{exact:true})).toBeVisible();

  const result=page.locator('.food-row.interactive').filter({hasText:'Keyboard nasi goreng'});
  const saveResult=result.getByRole('button',{name:/Save Keyboard nasi goreng/});
  await saveResult.focus();
  await saveResult.press('Enter');
  await expect(page.getByRole('heading',{name:'Log food',exact:true})).toBeVisible();

  await result.focus();
  await result.press('Enter');
  await expect(page.getByRole('heading',{name:'Review food',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Review food',exact:true})).toBeVisible();
  await expect(page.getByLabel('Quantity',{exact:true})).toBeFocused();

  const timeTrigger=page.locator('.custom-time-trigger');
  await timeTrigger.press('Enter');
  await expect(page.locator('.custom-time-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.custom-time-popover')).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Review food',exact:true})).toBeVisible();
});

test('mobile back dismisses the active sheet without leaving the diary',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.setViewportSize({width:390,height:800});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();

  const launcher=page.getByRole('button',{name:'Add entry',exact:true});
  await launcher.click();
  const sheet=page.getByRole('dialog',{name:'Add',exact:true});
  await expect(sheet).toBeVisible();
  expect(await page.locator('.topbar').evaluate(element=>getComputedStyle(element).position)).toBe('sticky');
  expect(await page.locator('.sidebar').evaluate(element=>getComputedStyle(element).position)).toBe('fixed');
  expect(await page.locator('.modal-surface').evaluate(element=>getComputedStyle(element,'::before').content)).toBe('""');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();

  const currentUrl=page.url();
  await page.evaluate(()=>window.history.back());
  await expect(sheet).toHaveCount(0);
  expect(page.url()).toBe(currentUrl);
  await expect(launcher).toBeFocused();
});

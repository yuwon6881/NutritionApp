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


for(const width of [390,768,1440])for(const theme of ['light','dark'])test(theme+' '+width+': compact batch, fresh searches, AI draft and recipe',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.setViewportSize({width,height:900});
  await page.addInitScript(theme=>localStorage.setItem('nourish-theme',theme),theme);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Log weight',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Food entries',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Choose diary date'})).toHaveCount(0);
  await page.getByRole('button',{name:'Add entry',exact:true}).click();
  await page.getByRole('dialog',{name:'Add',exact:true}).getByRole('button',{name:'Log food'}).click();
  await page.getByLabel('Search term',{exact:true}).fill('old query');
  await page.getByRole('button',{name:'Your foods',exact:true}).click();
  await expect(page.getByLabel('Find your food')).toHaveValue('');
  await page.getByLabel('Find your food').fill('Greek');
  await page.locator('.food-row.interactive').filter({hasText:'Greek Yogurt'}).click();
  await page.getByRole('button',{name:'Add to batch',exact:true}).click();
  await expect(page.locator('.batch-food input')).toHaveCount(0);
  await page.screenshot({path:'artifacts/dashboard-batch/'+theme+'-'+width+'.png'});
  const card=await page.locator('.live-calorie-card').boundingBox();
  const value=await page.locator('.live-calorie-value').boundingBox();
  expect(Math.abs(card!.y+card!.height/2-value!.y-value!.height/2)).toBeLessThan(3);
  await page.getByLabel('Meal time',{exact:true}).fill('13:45');
  await page.getByRole('button',{name:'Add more food'}).click();
  await expect(page.getByLabel('Find your food')).toHaveValue('');
  await page.getByRole('button',{name:'Barcode',exact:true}).click();
  await expect(page.getByLabel('Barcode digits')).toHaveValue('');
  await page.getByLabel('Barcode digits').fill('12345678');
  await page.getByRole('button',{name:'Search',exact:true}).first().click();
  await expect(page.getByLabel('Search term',{exact:true})).toHaveValue('');
  await page.route('**/api/scans',async route=>{
    const input=route.request().postDataJSON();expect(input.mode).toBe('description');expect(input.imageBase64).toBeNull();
    await route.fulfill({json:{id:input.id,status:'complete',resultJson:JSON.stringify({foods:[{name:'Text meal',quantity:1,unit:'serving',calories:230,protein:null,carbs:30,fat:7,fiber:null,notes:'Estimated portion'}],questions:[],explanation:'Estimate'})}});
  });
  await page.getByRole('button',{name:'AI logging',exact:true}).click();
  await page.getByLabel('Meal description and portions').fill('one bowl of rice');
  await page.getByRole('button',{name:'Estimate my meal',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Batch (2 foods)'})).toBeVisible();
  await expect(page.getByLabel('Meal time',{exact:true})).toHaveValue('13:45');
  await expect(page.locator('.batch-food').filter({hasText:'Text meal'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Add reviewed meal/})).toHaveCount(0);
  const textRow=page.locator('.batch-food').filter({hasText:'Text meal'});
  if(width<1024){await page.getByRole('button',{name:'Actions for Text meal'}).focus();await page.keyboard.press('Enter');}
  await textRow.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.getByLabel('Food name',{exact:true})).toBeFocused();
  await expect(page.getByLabel('Protein (g)',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  if(width<1024)await expect(page.getByRole('button',{name:'Actions for Text meal'})).toBeFocused();
  else await expect(textRow.getByRole('button',{name:'Edit',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Remove Text meal',exact:true}).click();
  await page.getByRole('button',{name:'Add more food'}).click();
  await expect(page.getByLabel('Meal description and portions')).toHaveValue('');
  await page.getByRole('button',{name:'Your foods',exact:true}).click();
  await page.getByRole('button',{name:'New recipe',exact:true}).click();
  await page.route('**/api/foods/search?*',route=>route.fulfill({json:[{name:'API oats',source:'Test provider',calories:380,protein:12,carbs:60,fat:7,fiber:null,servingGrams:100}]}));
  await page.getByLabel('Search ingredients').fill('oats');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('button',{name:'API oats',exact:true}).click();
  await expect(page.getByLabel('Search ingredients')).toHaveValue('');
  await page.getByLabel('Ingredient grams').fill('150');
  await page.getByRole('button',{name:'Add ingredient',exact:true}).click();
  await page.getByLabel('Recipe name').fill('Oats recipe '+theme+width);
  await page.getByRole('button',{name:'Save recipe',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your foods',exact:true})).toBeVisible();
  await expect.poll(async()=>{const state=await (await context.request.get('/api/state')).json();const recipe=state.foods.find((food:{name:string})=>food.name==='Oats recipe '+theme+width);return recipe?{calories:Math.round(recipe.calories*1e6)/1e6,fiber:recipe.fiber,count:JSON.parse(recipe.ingredientsJson).length}:null;}).toEqual({calories:114,fiber:null,count:1});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

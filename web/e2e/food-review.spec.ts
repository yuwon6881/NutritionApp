import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const data={username:'test-review',password:'batch test password 2026'};
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



async function openLog(page:import('@playwright/test').Page){
  await page.goto('/');
  await page.getByRole('button',{name:'Add entry',exact:true}).click();
  await page.getByRole('dialog',{name:'Add',exact:true}).getByRole('button',{name:'Log food'}).click();
}
const powder={name:'Protein powder with a deliberately long product name',source:'Open Food Facts / ODbL / 12345678',code:'12345678',servingGrams:100,calories:400,protein:80,carbs:null,fat:4,fiber:2};
for(const theme of ['light','dark'])test(`${theme} large barcode controls stay aligned`,async({page,context})=>{
  await context.addCookies(session.cookies);await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(theme=>localStorage.setItem('nourish-theme',theme),theme);
  await openLog(page);await page.getByRole('button',{name:'Barcode',exact:true}).click();
  const options=page.locator('.barcode-scan-options');
  const mode=options.locator('.barcode-scan-mode');
  const camera=options.getByRole('button',{name:'Scan barcode with camera',exact:true});
  await expect(camera).toBeVisible();
  const modeBox=(await mode.boundingBox())!,cameraBox=(await camera.boundingBox())!;
  expect(cameraBox.x).toBeGreaterThanOrEqual(modeBox.x+modeBox.width);
  expect(cameraBox.y).toBeLessThan(modeBox.y+modeBox.height);
  expect(cameraBox.y+cameraBox.height).toBeGreaterThan(modeBox.y);
  await page.screenshot({animations:'disabled',path:`artifacts/food-review/${theme}-1440-barcode.png`});
});
test('search results show declared serving calories and reuse them in review',async({page,context})=>{
  await context.addCookies(session.cookies);await page.setViewportSize({width:1440,height:900});
  const served={...powder,portions:[{label:'scoop',grams:30}],servingCalories:120};let lookups=0;
  await page.route('**/api/foods/search?*',route=>route.fulfill({json:[served]}));
  await page.route('**/api/foods/barcode/*',route=>{lookups++;return route.fulfill({json:served});});
  await openLog(page);await page.getByLabel('Search term',{exact:true}).fill('powder');await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  const row=page.locator('.food-row').first();await expect(row.locator('.food-description small')).toContainText('120 kcal / scoop (30 g)');
  await row.click();await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('1');await expect(page.locator('.live-calorie-value')).toContainText('120');expect(lookups).toBe(0);
});
for(const width of [390,768,1440])for(const theme of ['light','dark'])test(`${theme} ${width}: serving review, batch header and actions`,async({page,context})=>{
  await context.addCookies(session.cookies);await page.setViewportSize({width,height:900});
  await page.addInitScript(theme=>localStorage.setItem('nourish-theme',theme),theme);
  let lookups=0;
  await page.route('**/api/foods/search?*',route=>route.fulfill({json:[powder]}));
  await page.route('**/api/foods/barcode/*',route=>{lookups++;return route.fulfill({json:{...powder,portions:[{label:'scoop',grams:30}]}});});
  await openLog(page);
  await page.getByLabel('Search term',{exact:true}).fill('powder');
  await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.locator('.food-row')).toHaveCount(1);expect(lookups).toBe(0);
  await page.locator('.food-row').click();
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('1');
  await expect(page.locator('.live-calorie-value')).toContainText('120');
  await expect(page.locator('.live-calorie-meta')).not.toContainText('Fibre');
  await page.getByLabel('Quantity',{exact:true}).fill('0.5');
  await expect(page.locator('.live-calorie-value')).toContainText('60');
  await page.getByRole('button',{name:'Add to batch',exact:true}).click();
  const row=page.locator('.batch-food').first();
  if(width<1024){
    const surface=row.locator('.batch-food-summary');
    await surface.dispatchEvent('pointerdown',{pointerId:5,isPrimary:true,pointerType:'touch',button:0,clientX:250,clientY:300});
    // Cancelled gestures must leave the row closed.
    await surface.dispatchEvent('pointercancel',{pointerId:5});
    await expect(row).not.toHaveClass(/dragging|actions-open/);
    const box=(await surface.boundingBox())!;
    const touch=await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width-100,y:box.y+25}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width-175,y:box.y+25}]});
    await expect(row).toHaveClass(/dragging/);
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(row).toHaveClass(/actions-open/);
    await touch.detach();
    await expect(row.locator('.batch-food-actions').getByRole('button',{name:'Edit',exact:true})).toBeVisible();
    await row.locator('.batch-food-actions').getByRole('button',{name:'Edit',exact:true}).click();
  }else await row.locator('.batch-food-desktop-actions').getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('0.5');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('button',{name:'Add more food'}).click();
  const header=page.locator('.food-modal .modal-header');
  await expect(header.getByRole('button',{name:'View batch, 1 foods'})).toBeVisible();
  const title=(await header.getByRole('heading').boundingBox())!,batch=(await header.getByRole('button',{name:'View batch, 1 foods'}).boundingBox())!;
  expect(batch.x).toBeGreaterThan(title.x+title.width);expect(batch.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({animations:'disabled',path:`artifacts/food-review/${theme}-${width}-header.png`});
  await header.getByRole('button',{name:'View batch, 1 foods'}).click();
  await page.screenshot({animations:'disabled',path:`artifacts/food-review/${theme}-${width}-batch.png`});
  expect(lookups).toBe(1);
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await page.locator('.batch-food-summary').evaluate(element=>getComputedStyle(element).transitionDuration)).toBe('0s');
});

test('text selection outside clean and dirty modals does not dismiss',async({page,context})=>{
  await context.addCookies(session.cookies);await page.setViewportSize({width:1440,height:900});await openLog(page);
  async function dragOutside(label:string){
    const input=page.getByLabel(label,{exact:true});await input.fill('Selection text');
    const box=(await input.boundingBox())!;await page.mouse.move(box.x+box.width-20,box.y+box.height/2);await page.mouse.down();await page.mouse.move(5,5,{steps:10});await page.mouse.up();
    await expect(input).toBeVisible();await expect(page.getByRole('alertdialog')).toHaveCount(0);
  }
  await dragOutside('Search term');
  await page.getByRole('button',{name:'Manual entry',exact:true}).click();await dragOutside('Food name');
  await page.mouse.click(5,5);await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button',{name:'Keep editing'}).click();await expect(page.getByLabel('Food name',{exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('failed details retain selection, allow grams and a manual serving',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.route('**/api/foods/search?*',route=>route.fulfill({json:[powder]}));
  await page.route('**/api/foods/barcode/*',route=>route.fulfill({status:503,json:{message:'Test provider unavailable'}}));
  await openLog(page);await page.getByLabel('Search term',{exact:true}).fill('powder');await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();await page.locator('.food-row').click();
  await expect(page.getByRole('button',{name:'Retry serving lookup'})).toBeVisible();
  await page.getByRole('button',{name:'Review using 100 g'}).click();await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('100');
  await page.getByLabel('Serving weight (g)',{exact:true}).fill('30');await page.getByRole('button',{name:'Use this serving'}).click();
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('1');await expect(page.locator('.live-calorie-value')).toContainText('120');
});


test('late product details cannot replace a manually opened editor',async({page,context})=>{
  await context.addCookies(session.cookies);
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/foods/search?*',route=>route.fulfill({json:[powder]}));
  await page.route('**/api/foods/barcode/*',async route=>{await pending;await route.fulfill({json:{...powder,portions:[{label:'scoop',grams:30}]}});});
  await openLog(page);await page.getByLabel('Search term',{exact:true}).fill('powder');await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();await page.locator('.food-row').click();
  await expect(page.locator('.food-detail-status')).toHaveAttribute('aria-busy','true');
  await page.getByRole('button',{name:'Manual entry',exact:true}).click();await page.getByLabel('Food name',{exact:true}).fill('My own food');
  const response=page.waitForResponse('**/api/foods/barcode/*');release();await response;
  await expect(page.getByLabel('Food name',{exact:true})).toHaveValue('My own food');
});

test('saved barcode portions survive reopening and conversion to grams',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.route('**/api/foods/barcode/*',route=>route.fulfill({json:{...powder,portions:[{label:'scoop',grams:30}]}}));
  await openLog(page);await page.getByRole('button',{name:'Barcode',exact:true}).click();
  await page.getByLabel('Barcode digits').fill('12345678');await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('button',{name:`Save ${powder.name} to your foods`,exact:true}).click();
  await page.getByRole('button',{name:'Your foods',exact:true}).click();
  await page.locator('.food-row').filter({hasText:powder.name}).click();
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('1');
  await page.locator('#food-unit').selectOption('g');
  await page.getByLabel('Quantity',{exact:true}).fill('30');await expect(page.locator('.live-calorie-value')).toContainText('120');
});

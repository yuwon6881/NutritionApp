import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from './signIn';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const response=await signInApi(request,'test-review');
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
const powder={name:'Protein powder with a deliberately long product name',source:'Open Food Facts / ODbL / 12345678',code:'12345678',servingGrams:100,calories:400,protein:80,carbs:null,fat:4,fiber:2,basis:'unverified' as const};
for(const theme of ['light','dark'])test(`${theme} large barcode controls stay aligned`,async({page,context})=>{
  await context.addCookies(session.cookies);await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(theme=>localStorage.setItem('nourish-theme',theme),theme);
  await openLog(page);await page.getByRole('button',{name:'Barcode',exact:true}).click();
  const options=page.locator('.food-selection');
  const camera=page.getByRole('button',{name:'Scan barcode with camera',exact:true});
  await expect(camera).toBeVisible();
  await expect(options.getByText('Scan mode',{exact:true})).toHaveCount(0);
  await expect(options.getByText('Multiple barcodes',{exact:true})).toHaveCount(0);
  const cameraBox=(await camera.boundingBox())!;
  expect(cameraBox.x).toBeGreaterThanOrEqual(0);
  expect(cameraBox.x+cameraBox.width).toBeLessThanOrEqual(1440);
  expect(cameraBox.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({animations:'disabled',path:`artifacts/food-review/${theme}-1440-barcode.png`});
});
test('search results show declared serving calories and reuse them in review',async({page,context})=>{
  await context.addCookies(session.cookies);await page.setViewportSize({width:1440,height:900});
  const served={...powder,portions:[{label:'scoop',grams:30}],servingCalories:120,basis:'per100g' as const};let lookups=0;
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
  await page.route('**/api/foods/barcode/*',route=>{lookups++;return route.fulfill({json:{...powder,basis:'per100g' as const,portions:[{label:'scoop',grams:30}]}});});
  await openLog(page);
  await page.getByLabel('Search term',{exact:true}).fill('powder');
  await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  const searchRow=page.locator('.food-row').first();
  await expect(searchRow).toBeVisible();
  await expect(searchRow.locator('.food-description small')).toContainText('Basis unavailable');
  await expect(searchRow.locator('.food-description small')).not.toContainText('/ 100 g');
  expect(lookups).toBe(0);
  await searchRow.click();
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('1');
  await expect(page.locator('.live-calorie-value')).toContainText('120');
  await expect(page.locator('.live-calorie-meta')).not.toContainText('Fibre');
  await page.getByLabel('Quantity',{exact:true}).fill('0.5');
  await expect(page.locator('.live-calorie-value')).toContainText('60');
  await page.getByRole('button',{name:'Add to batch',exact:true}).click();
  const row=page.locator('.batch-food').first();
  await expect(row.locator('.food-macro-summary')).toHaveAttribute('aria-label','Macros: Protein 12 g, Carbs — g, Fat 0.6 g');
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
  await page.route('**/api/foods/barcode/*',route=>route.fulfill({json:{...powder,basis:'per100g' as const,portions:[{label:'scoop',grams:30}]}}));
  await openLog(page);await page.getByRole('button',{name:'Barcode',exact:true}).click();
  await page.getByLabel('Barcode digits').fill('12345678');await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('button',{name:`Save ${powder.name} to your foods`,exact:true}).click();
  await page.getByRole('button',{name:'Your foods',exact:true}).click();
  await page.locator('.food-row').filter({hasText:powder.name}).click();
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('1');
  await page.locator('#food-unit').selectOption('g');
  await page.getByLabel('Quantity',{exact:true}).fill('30');await expect(page.locator('.live-calorie-value')).toContainText('120');
});

test('hydrated search hit for Optimum Nutrition displays declared serving calories and opens review directly',async({page,context})=>{
  await context.addCookies(session.cookies);await page.setViewportSize({width:1440,height:900});
  const hydrated={
    name:'Optimum nutrition whey protein',
    source:'Open Food Facts / ODbL / 0748927065725',
    code:'0748927065725',
    calories:384.87,
    protein:78.95,
    fat:3.29,
    carbs:9.87,
    fiber:null,
    servingGrams:100,
    portions:[{label:'30.4 g',grams:30.4}],
    servingCalories:117,
    basis:'per100g' as const,
  };
  let lookups=0;
  await page.route('**/api/foods/search?*',route=>route.fulfill({json:[hydrated]}));
  await page.route('**/api/foods/barcode/*',route=>{lookups++;return route.fulfill({json:hydrated});});
  await openLog(page);await page.getByLabel('Search term',{exact:true}).fill('Optimum nutrition');await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  const row=page.locator('.food-row').first();
  await expect(row.locator('.food-description small')).toContainText('117 kcal / 30.4 g');
  await expect(row.locator('.food-description small')).not.toContainText('/ 100 g');
  await row.click();
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('1');
  await expect(page.locator('.live-calorie-value')).toContainText('117');
  expect(lookups).toBe(0);
});

test('failed bulk hydration displays basis unavailable and resolves serving on click',async({page,context})=>{
  await context.addCookies(session.cookies);await page.setViewportSize({width:1440,height:900});
  const unverifiedHit={
    name:'Optimum nutrition whey protein',
    source:'Open Food Facts / ODbL / 0748927065725',
    code:'0748927065725',
    calories:117,
    protein:24,
    fat:1,
    carbs:3,
    fiber:null,
    servingGrams:100,
    portions:[],
    basis:'unverified' as const,
  };
  const authoritativeDetail={
    ...unverifiedHit,
    calories:384.87,
    protein:78.95,
    fat:3.29,
    carbs:9.87,
    portions:[{label:'30.4 g',grams:30.4}],
    servingCalories:117,
    basis:'per100g' as const,
  };
  let lookups=0;
  await page.route('**/api/foods/search?*',route=>route.fulfill({json:[unverifiedHit]}));
  await page.route('**/api/foods/barcode/*',route=>{lookups++;return route.fulfill({json:authoritativeDetail});});
  await openLog(page);await page.getByLabel('Search term',{exact:true}).fill('Optimum nutrition');await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  const row=page.locator('.food-row').first();
  await expect(row.locator('.food-description strong')).toContainText('Optimum nutrition whey protein');
  await expect(row.locator('.food-description small')).toContainText('Basis unavailable · Open Food Facts / ODbL / 0748927065725');
  await expect(row.locator('.food-description small')).not.toContainText('/ 100 g');
  await expect(row.locator('.food-description small')).not.toContainText('117 kcal');
  const detailResponse=page.waitForResponse('**/api/foods/barcode/*');
  await row.click();
  await detailResponse;
  expect(lookups).toBe(1);
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('1');
  await expect(page.locator('.live-calorie-value')).toContainText('117');
});

test('direct barcode result without declared serving displays / 100 g',async({page,context})=>{
  await context.addCookies(session.cookies);await page.setViewportSize({width:1440,height:900});
  const servinglessBarcode={
    name:'Rolled Oats · Quaker',
    source:'Open Food Facts / ODbL / 0123456789012',
    code:'0123456789012',
    calories:370,
    protein:13,
    fat:7,
    carbs:60,
    fiber:null,
    servingGrams:100,
    portions:[],
    basis:'per100g' as const,
  };
  await page.route('**/api/foods/barcode/*',route=>route.fulfill({json:servinglessBarcode}));
  await openLog(page);await page.getByRole('button',{name:'Barcode',exact:true}).click();
  await page.getByLabel('Barcode digits').fill('0123456789012');await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  const row=page.locator('.food-row').first();
  await expect(row.locator('.food-description small')).toContainText('370 kcal / 100 g');
});

test('barcode misses can link a private food and repeat offline from the local mapping',async({page,context})=>{
  await context.addCookies(session.cookies);
  let providerCalls=0;
  await page.route('**/api/foods/barcode/*',route=>{
    providerCalls++;
    return route.fulfill({status:404,json:{message:'Barcode not found. Scan the label or add a custom food.'}});
  });
  await openLog(page);
  await page.getByRole('button',{name:'Barcode',exact:true}).click();
  await page.getByLabel('Barcode digits').fill('9559876543210');
  await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Barcode not found in Open Food Facts',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Link an existing food',exact:true}).click();
  await expect(page.getByText(/Choose one saved non-recipe food/)).toBeVisible();
  await page.locator('.food-row.interactive').filter({hasText:'Greek Yogurt 0%'}).click();
  await expect(page.getByRole('heading',{name:'Greek Yogurt 0%',exact:true})).toBeVisible();
  await page.locator('.food-modal').getByRole('button',{name:'Back',exact:true}).first().click();
  await page.getByRole('button',{name:'Barcode',exact:true}).click();
  await page.getByLabel('Barcode digits').fill('9559876543210');
  await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.locator('.food-row').filter({hasText:'Greek Yogurt 0%'})).toBeVisible();
  expect(providerCalls).toBe(1);
});

test('barcode label recovery normalizes a declared serving before explicit save',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.route('**/api/foods/barcode/*',route=>route.fulfill({status:404,json:{message:'Barcode not found. Scan the label or add a custom food.'}}));
  await page.route('**/api/scans',async route=>{
    const input=route.request().postDataJSON();
    expect(input.mode).toBe('label');
    await route.fulfill({json:{id:input.id,status:'complete',resultJson:JSON.stringify({foods:[{
      name:'Ayam tuna can',quantity:1,unit:'serving',calories:333,protein:null,carbs:0,fat:4,fiber:null,
      portionLabel:'can',portionGrams:185,notes:'Read from the label; verify the can size.'
    }],questions:[],explanation:'One product'})}});
  });
  await openLog(page);
  await page.getByRole('button',{name:'Barcode',exact:true}).click();
  await page.getByLabel('Barcode digits').fill('9551234567890');
  await page.locator('form').getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('button',{name:'Scan nutrition label',exact:true}).click();
  const onePixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  await page.getByLabel('Photograph the nutrition label',{exact:true}).setInputFiles({name:'label.png',mimeType:'image/png',buffer:onePixel});
  await expect(page.getByText('Location metadata removed · deleted after processing.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Read nutrition label',exact:true}).click();
  await expect(page.getByLabel('Calories (kcal)',{exact:true})).toHaveValue('180');
  await expect(page.getByLabel('Protein (g)',{exact:true})).toHaveValue('');
  await expect(page.locator('#food-portion-definition-0-label')).toHaveValue('can');
  await expect(page.locator('#food-portion-definition-0-grams')).toHaveValue('185');
  await page.getByRole('button',{name:'Save custom food',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Ayam tuna can',exact:true})).toBeVisible();
});

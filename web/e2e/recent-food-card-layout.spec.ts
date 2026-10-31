import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {seedMobileUser,testOrigin,todayInTestZone} from './helpers/seed';

const USERNAME='food-card-layout-user';
const zone='Asia/Kuala_Lumpur';

let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hour12:false});
  const [nowH,nowM]=formatter.format(new Date()).split(':').map(Number);
  const pad=(n:number)=>String(n).padStart(2,'0');

  // Times around current hour for picks
  const pickTime1=`${pad(nowH)}:05`;
  const pickTime2=`${pad(nowH)}:10`;

  // Times slightly newer for latest section
  const latestH=(nowH+1)%24;
  const t=(m:number)=>`${pad(latestH)}:${pad(m)}`;

  session=await seedMobileUser(request,USERNAME,[
    // Today's entries: picks candidates
    {name:'HL MILK',calories:250,protein:21,carbs:31.5,fat:4.5,fiber:0,quantity:500,unit:'g',measure:'ml',time:pickTime1},
    {name:'Quick add',calories:200,time:pickTime2},
    // Latest entries sorted newest-first:
    {name:'white rice',calories:390,time:t(55)},
    {name:'Egg Tart',calories:195,time:t(50)},
    {name:'Double Cheeseburger',calories:226,time:t(45)},
    {name:'Potato, boiled',calories:607,time:t(40)},
    {name:'Sweet And Sour Chicken',calories:638,time:t(35)},
    {name:'Cooked chicken breast',calories:325,time:t(30)},
    {name:'100% Whole Wheat Bread',calories:261,time:t(25)},
    {name:'Quadrattini hazelnut',calories:309,time:t(20)},
    {name:'Optimum nutrition whey',calories:117,time:t(15)},
  ]);

  // Seed HL MILK and Quick add for past days so they qualify for "picks" (requires >= 2 distinct days)
  const current=todayInTestZone();
  const yesterdayDate=new Date(`${current}T12:00:00Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate()-1);
  const yesterday=yesterdayDate.toISOString().slice(0,10);

  const twoDaysAgoDate=new Date(`${current}T12:00:00Z`);
  twoDaysAgoDate.setUTCDate(twoDaysAgoDate.getUTCDate()-2);
  const twoDaysAgo=twoDaysAgoDate.toISOString().slice(0,10);

  const headers={Origin:testOrigin,'X-Nutrition-Request':'1'};

  const res1=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),kind:'entry',recordId:randomUUID(),expectedRevision:0,delete:false,
    data:{date:yesterday,name:'HL MILK',calories:250,protein:21,carbs:31.5,fat:4.5,fiber:0,quantity:500,unit:'g',measure:'ml',time:pickTime1}
  }});
  expect(res1.ok(),await res1.text()).toBeTruthy();

  const res2=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),kind:'entry',recordId:randomUUID(),expectedRevision:0,delete:false,
    data:{date:yesterday,name:'Quick add',calories:200,protein:0,carbs:0,fat:0,fiber:0,quantity:1,unit:'serving',time:pickTime2}
  }});
  expect(res2.ok(),await res2.text()).toBeTruthy();

  const res3=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),kind:'entry',recordId:randomUUID(),expectedRevision:0,delete:false,
    data:{date:twoDaysAgo,name:'HL MILK',calories:250,protein:21,carbs:31.5,fat:4.5,fiber:0,quantity:500,unit:'g',measure:'ml',time:pickTime1}
  }});
  expect(res3.ok(),await res3.text()).toBeTruthy();
});

async function openLogFoodModal(page:Page,width:number,height:number,theme:'light'|'dark'='dark'){
  await page.context().addCookies(session.cookies);
  await page.setViewportSize({width,height});
  await page.addInitScript(t=>localStorage.setItem('nutrition-theme',t),theme);
  await page.goto('/');
  await expect(page.locator('.account-name')).toHaveText(USERNAME);
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);

  // Open Log Food modal
  const addBtn=page.getByRole('button',{name:'Add entry',exact:true});
  if(await addBtn.isVisible()){
    await addBtn.click();
    const addSheet=page.getByRole('dialog',{name:'Add',exact:true});
    await expect(addSheet).toBeVisible();
    await addSheet.getByRole('button',{name:'Log food',exact:true}).click();
  }else{
    await page.getByRole('button',{name:'Food Log'}).first().click();
    await page.getByRole('button',{name:'Log food'}).first().click();
  }

  const foodDialog=page.getByRole('dialog',{name:'Log food',exact:true});
  await expect(foodDialog).toBeVisible();
  // Wait for recent food cards to render
  const cards=foodDialog.locator('.recent-food-card');
  await expect(cards.first()).toBeVisible();
  return foodDialog;
}

test('Desktop (1280px) renders food log cards in 2 columns with unwrapped short names and clear text',async({page})=>{
  const dialog=await openLogFoodModal(page,1280,850,'dark');
  const group=dialog.locator('.recent-foods-group');
  await expect(group).toBeVisible();
  const cards=group.locator('.recent-food-card');
  const count=await cards.count();
  expect(count).toBeGreaterThanOrEqual(4);

  // Check columns: on desktop, grid has 2 columns (cards side by side in pairs)
  const box0=await cards.nth(0).boundingBox();
  const box1=await cards.nth(1).boundingBox();
  expect(box0).not.toBeNull();
  expect(box1).not.toBeNull();
  expect(Math.abs(box0!.y-box1!.y)).toBeLessThan(5);
  expect(box1!.x).toBeGreaterThan(box0!.x+box0!.width/2);

  // Card 2 is on the next row (y > y0), NOT a 3rd column
  const box2=await cards.nth(2).boundingBox();
  expect(box2).not.toBeNull();
  expect(box2!.y).toBeGreaterThan(box0!.y+box0!.height/2);

  // Check "white rice" card name is on a single line
  const whiteRiceName=group.locator('.recent-food-card', {hasText:'white rice'}).locator('.recent-food-name');
  await expect(whiteRiceName).toBeVisible();
  const whiteRiceBox=await whiteRiceName.boundingBox();
  expect(whiteRiceBox).not.toBeNull();
  expect(whiteRiceBox!.height).toBeLessThan(26);

  // Check "Egg Tart" name is on a single line
  const eggTartName=group.locator('.recent-food-card', {hasText:'Egg Tart'}).locator('.recent-food-name');
  await expect(eggTartName).toBeVisible();
  const eggTartBox=await eggTartName.boundingBox();
  expect(eggTartBox!.height).toBeLessThan(26);

  // Check picks section and "HL MILK" card is on a single line
  const picks=dialog.locator('.recent-foods-picks');
  await expect(picks).toBeVisible();
  const hlMilkName=picks.locator('.recent-food-card',{hasText:'HL MILK'}).locator('.recent-food-name');
  await expect(hlMilkName).toBeVisible();
  const hlBox=await hlMilkName.boundingBox();
  expect(hlBox).not.toBeNull();
  expect(hlBox!.height).toBeLessThan(26);

  // Verify no horizontal overflow in any visible cards
  const overflows=await dialog.locator('.recent-food-card').evaluateAll(elements=>
    elements.some(el=>el.scrollWidth>el.clientWidth+1)
  );
  expect(overflows).toBe(false);

  // Capture desktop viewport screenshots (not fullPage to preserve authentic dialog frame)
  await page.screenshot({path:'artifacts/responsive-boundaries/desktop-food-log-cards-dark.png',fullPage:false});
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
  await page.waitForTimeout(200);
  await page.screenshot({path:'artifacts/responsive-boundaries/desktop-food-log-cards-light.png',fullPage:false});
});

test('Tablet (768px) renders food log cards legibly in 2 columns',async({page})=>{
  const dialog=await openLogFoodModal(page,768,1024,'dark');
  const group=dialog.locator('.recent-foods-group');
  await expect(group).toBeVisible();
  const cards=group.locator('.recent-food-card');
  const count=await cards.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // In 768px tablet view, grid has 2 columns
  const box0=await cards.nth(0).boundingBox();
  const box1=await cards.nth(1).boundingBox();
  expect(box0).not.toBeNull();
  expect(box1).not.toBeNull();
  expect(Math.abs(box0!.y-box1!.y)).toBeLessThan(5);

  // Check "white rice" is on a single line
  const whiteRiceName=group.locator('.recent-food-card', {hasText:'white rice'}).locator('.recent-food-name');
  await expect(whiteRiceName).toBeVisible();
  const whiteRiceBox=await whiteRiceName.boundingBox();
  expect(whiteRiceBox).not.toBeNull();
  expect(whiteRiceBox!.height).toBeLessThan(26);

  // Check "Egg Tart" is on a single line
  const eggTartName=group.locator('.recent-food-card', {hasText:'Egg Tart'}).locator('.recent-food-name');
  await expect(eggTartName).toBeVisible();
  const eggTartBox=await eggTartName.boundingBox();
  expect(eggTartBox!.height).toBeLessThan(26);

  // Check picks section and "HL MILK" card is on a single line
  const picks=dialog.locator('.recent-foods-picks');
  await expect(picks).toBeVisible();
  const hlMilkName=picks.locator('.recent-food-card',{hasText:'HL MILK'}).locator('.recent-food-name');
  await expect(hlMilkName).toBeVisible();
  const hlBox=await hlMilkName.boundingBox();
  expect(hlBox).not.toBeNull();
  expect(hlBox!.height).toBeLessThan(26);

  // Verify no horizontal overflow
  const overflows=await dialog.locator('.recent-food-card').evaluateAll(elements=>
    elements.some(el=>el.scrollWidth>el.clientWidth+1)
  );
  expect(overflows).toBe(false);

  // Capture tablet viewport screenshots
  await page.screenshot({path:'artifacts/responsive-boundaries/tablet-food-log-cards-dark.png',fullPage:false});
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
  await page.waitForTimeout(200);
  await page.screenshot({path:'artifacts/responsive-boundaries/tablet-food-log-cards-light.png',fullPage:false});
});

test('Mobile (390px and 320px) renders food log cards in 1 column with clear text and no overflow',async({page})=>{
  // 390px mobile
  const dialog390=await openLogFoodModal(page,390,844,'dark');
  const group390=dialog390.locator('.recent-foods-group');
  await expect(group390).toBeVisible();
  const cards390=group390.locator('.recent-food-card');
  expect(await cards390.count()).toBeGreaterThanOrEqual(2);

  // In mobile view, cards are 1 column (each below the previous)
  const box0=await cards390.nth(0).boundingBox();
  const box1=await cards390.nth(1).boundingBox();
  expect(box1!.y).toBeGreaterThan(box0!.y+box0!.height/2);

  // "white rice" is on a single line
  const whiteRiceName=group390.locator('.recent-food-card', {hasText:'white rice'}).locator('.recent-food-name');
  await expect(whiteRiceName).toBeVisible();
  const whiteRiceBox=await whiteRiceName.boundingBox();
  expect(whiteRiceBox!.height).toBeLessThan(26);

  // "Egg Tart" is on a single line
  const eggTartName=group390.locator('.recent-food-card', {hasText:'Egg Tart'}).locator('.recent-food-name');
  await expect(eggTartName).toBeVisible();
  const eggTartBox=await eggTartName.boundingBox();
  expect(eggTartBox!.height).toBeLessThan(26);

  // Check picks section and "HL MILK" card is on a single line
  const picks390=dialog390.locator('.recent-foods-picks');
  await expect(picks390).toBeVisible();
  const hlMilkName390=picks390.locator('.recent-food-card',{hasText:'HL MILK'}).locator('.recent-food-name');
  await expect(hlMilkName390).toBeVisible();
  const hlBox390=await hlMilkName390.boundingBox();
  expect(hlBox390).not.toBeNull();
  expect(hlBox390!.height).toBeLessThan(26);

  // Check no horizontal overflow
  const overflows390=await dialog390.locator('.recent-food-card').evaluateAll(elements=>
    elements.some(el=>el.scrollWidth>el.clientWidth+1)
  );
  expect(overflows390).toBe(false);

  // Capture 390px viewport screenshots
  await page.screenshot({path:'artifacts/responsive-boundaries/mobile-food-log-cards-dark.png',fullPage:false});
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
  await page.waitForTimeout(200);
  await page.screenshot({path:'artifacts/responsive-boundaries/mobile-food-log-cards-light.png',fullPage:false});

  // Now test 320px compact mobile boundary with a dedicated modal opening
  const dialog320=await openLogFoodModal(page,320,640,'dark');
  const group320=dialog320.locator('.recent-foods-group');
  await expect(group320).toBeVisible();

  const whiteRice320=group320.locator('.recent-food-card', {hasText:'white rice'}).locator('.recent-food-name');
  await expect(whiteRice320).toBeVisible();
  const box320=await whiteRice320.boundingBox();
  expect(box320!.height).toBeLessThan(26);

  const picks320=dialog320.locator('.recent-foods-picks');
  await expect(picks320).toBeVisible();
  const hlMilk320=picks320.locator('.recent-food-card',{hasText:'HL MILK'}).locator('.recent-food-name');
  await expect(hlMilk320).toBeVisible();
  const boxHl320=await hlMilk320.boundingBox();
  expect(boxHl320).not.toBeNull();
  expect(boxHl320!.height).toBeLessThan(26);

  // Verify modal body does not horizontally scroll
  const modalBodyHasHScroll=await dialog320.locator('.modal-body').evaluate((el:HTMLElement)=>
    el.scrollWidth>el.clientWidth+1
  );
  expect(modalBodyHasHScroll).toBe(false);

  // Capture 320px viewport screenshot
  await page.screenshot({path:'artifacts/responsive-boundaries/mobile-320px-food-log-cards-dark.png',fullPage:false});
});

import {test,expect,type Page} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';

// Fast logging keeps the batch review: a recent food reaches "Log" in one tap
// from the dialog. Dashboard stays focused on daily summaries.
let session:Awaited<ReturnType<typeof seedMobileUser>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,'mobile-logging-user',[
    {name:'Overnight oats',time:'08:00',calories:410},
    {name:'Chicken rice bowl',time:'13:00',calories:620},
  ]);
});

test.beforeEach(async({context})=>{await context.addCookies(session.cookies);});

const foodCards=(page:Page,name:string)=>page.locator('.food-time-card').filter({has:page.getByRole('heading',{name})});

async function openFoodLog(page:Page){
  await page.goto('/');
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Food Log',exact:true,level:1})).toBeVisible();
}

test('a recent food goes straight to the batch review with its last portion',async({page})=>{
  await openFoodLog(page);
  const before=await foodCards(page,'Porridge').count();
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Log food',exact:true});
  const recents=dialog.getByRole('region',{name:'Recent and frequent'});
  await expect(recents).toBeVisible();

  await recents.getByRole('button',{name:/^Porridge,/}).click();
  const batch=page.getByRole('dialog',{name:'Batch (1 food)',exact:true});
  await expect(batch).toBeVisible();
  const logButton=batch.getByRole('button',{name:'Log all 1 food',exact:true});
  await expect(logButton).toBeFocused();
  await logButton.click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(foodCards(page,'Porridge')).toHaveCount(before+1);
});

test('the batch review previews the day total with the batch drawn after logged food',async({page})=>{
  await openFoodLog(page);
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  const recents=page.getByRole('dialog',{name:'Log food',exact:true}).getByRole('region',{name:'Recent and frequent'});
  await recents.getByRole('button',{name:/^Porridge,/}).click();
  const preview=page.getByRole('dialog',{name:'Batch (1 food)',exact:true}).getByRole('region',{name:'Day total after logging'});
  await expect(preview.getByText('TODAY AFTER LOGGING')).toBeVisible();
  await expect(preview.getByText('+350 kcal')).toBeVisible();
  await expect(preview.getByRole('img',{name:/ kcal after logging, including 350 kcal from this batch$/})).toBeVisible();
  await expect(preview.locator('.ring-pending')).toHaveCount(1);
});

test('Dashboard omits Log again while recent foods remain in the picker',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Log again'})).toHaveCount(0);
});

test('search runs after a pause in typing and reuses a repeated query',async({page})=>{
  let calls=0;
  await page.route('**/api/foods/search?**',async route=>{
    calls+=1;
    await route.fulfill({json:[{name:'Boiled egg',calories:155,protein:13,carbs:1.1,fat:11,fiber:0,source:'Open Food Facts',servingGrams:100,portions:[{label:'1 egg',grams:50}],code:null,basis:'per100g'}]});
  });
  await openFoodLog(page);
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  const search=page.getByRole('dialog').getByLabel('Search term',{exact:true});
  await search.fill('eg');
  await page.waitForTimeout(1100);
  expect(calls).toBe(0);

  await search.fill('egg');
  await expect(page.getByRole('button',{name:'Boiled egg',exact:true})).toBeVisible();
  expect(calls).toBe(1);

  await search.fill('eggs');
  await search.fill('egg');
  await page.waitForTimeout(1100);
  expect(calls).toBe(1);
});

test('the search field shows that a search is in flight',async({page})=>{
  let release=()=>{};
  const answered=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/foods/search?**',async route=>{
    await answered;
    await route.fulfill({json:[{name:'Rolled oats',calories:379,protein:13,carbs:68,fat:6.5,fiber:10,source:'Open Food Facts',servingGrams:100,portions:[],code:null,basis:'per100g'}]});
  });
  await openFoodLog(page);
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  const search=page.getByRole('dialog').getByLabel('Search term',{exact:true});
  await search.fill('oats');
  // Remounting the input when the indicator appears would close the on-screen keyboard.
  await search.evaluate(input=>{(window as unknown as {searchInput:Element}).searchInput=input;});
  const spinner=page.getByRole('status',{name:'Searching',exact:true});
  await expect(spinner).toBeVisible();
  await expect(search).toBeFocused();
  release();
  await expect(page.getByRole('button',{name:'Rolled oats',exact:true})).toBeVisible();
  await expect(spinner).toHaveCount(0);
  await expect(search).toBeFocused();
  expect(await search.evaluate(input=>input===(window as unknown as {searchInput:Element}).searchInput)).toBe(true);
});

test('a reviewed provider food starts at its declared serving without shortcut chips',async({page})=>{
  await page.route('**/api/foods/search?**',route=>route.fulfill({json:[{name:'Boiled egg',calories:155,protein:13,carbs:1.1,fat:11,fiber:0,source:'Open Food Facts',servingGrams:100,portions:[{label:'1 egg',grams:50}],code:null,basis:'per100g'}]}));
  await openFoodLog(page);
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Search term',{exact:true}).fill('egg');
  await page.getByRole('button',{name:'Boiled egg',exact:true}).click();
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('1');
  await expect(page.locator('.live-calorie-value')).toContainText('78');
  await expect(page.getByRole('group',{name:/Quick .* amounts/})).toHaveCount(0);
  // Nutrients are per 100 g, so a serving without a weight is not offered for a provider food.
  await expect(page.locator('#food-unit option',{hasText:'Serving (weight unknown)'})).toHaveCount(0);
});

test('Back steps out of review, batch line edit, and batch without closing the food dialog',async({page})=>{
  let calls=0;
  await page.route('**/api/foods/search?**',route=>{calls+=1;return route.fulfill({json:[{name:'Boiled egg',calories:155,protein:13,carbs:1.1,fat:11,fiber:0,source:'Open Food Facts',servingGrams:100,portions:[{label:'1 egg',grams:50}],code:null,basis:'per100g'}]});});
  await openFoodLog(page);
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  const logDialog=page.getByRole('dialog',{name:'Log food',exact:true});
  await logDialog.getByLabel('Search term',{exact:true}).fill('egg');
  await page.getByRole('button',{name:'Boiled egg',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Review food',exact:true})).toBeVisible();

  await page.goBack();
  await expect(logDialog).toBeVisible();
  // The query and its answers come back as they were, without another search.
  await expect(logDialog.getByLabel('Search term',{exact:true})).toHaveValue('egg');
  await expect(page.getByRole('button',{name:'Boiled egg',exact:true})).toBeVisible();
  await page.waitForTimeout(1100);
  expect(calls).toBe(1);

  await page.getByRole('button',{name:'Boiled egg',exact:true}).click();
  await page.getByRole('button',{name:'Add to batch',exact:true}).click();
  const batch=page.getByRole('dialog',{name:'Batch (1 food)',exact:true});
  await expect(batch).toBeVisible();
  await batch.getByRole('button',{name:'Actions for Boiled egg',exact:true}).click();
  await batch.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(batch.getByLabel('Food name',{exact:true})).toBeVisible();

  await page.goBack();
  await expect(batch.getByLabel('Food name',{exact:true})).toHaveCount(0);
  await expect(batch.getByRole('button',{name:'Log all 1 food',exact:true})).toBeVisible();

  await page.goBack();
  await expect(logDialog).toBeVisible();
  await expect(logDialog.getByRole('button',{name:'View batch, 1 foods',exact:true})).toBeVisible();

  // Leave no batch behind for the tests that follow.
  await logDialog.getByRole('button',{name:'View batch, 1 foods',exact:true}).click();
  await batch.getByRole('button',{name:'Actions for Boiled egg',exact:true}).click();
  await batch.getByRole('button',{name:'Remove Boiled egg',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove Boiled egg',exact:true})).toHaveCount(0);
});

// Earlier tests in this file log food today, so read the true total from the ring's accessible name.
async function ringRemaining(page:Page){
  const ring=page.getByRole('img',{name:/^[\d,]+ of [\d,]+ kcal logged$/});
  await expect(ring).toBeVisible();
  const [logged,target]=(await ring.getAttribute('aria-label'))!.match(/[\d,]+/g)!.map(value=>Number(value.replace(/,/g,'')));
  expect(logged).toBeGreaterThanOrEqual(1030);
  return {ring,expected:(target-logged).toLocaleString('en-MY')};
}

test('the Dashboard ring shows its true remaining value at once with reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  const {ring,expected}=await ringRemaining(page);
  await expect(ring.locator('text').first()).toHaveText(expected,{timeout:100});
});

test('the Dashboard landing count settles on the true remaining value',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/');
  const {ring,expected}=await ringRemaining(page);
  await expect(ring.locator('text').first()).toHaveText(expected,{timeout:3000});
  // The cascade leaves no transform behind on the cards once it finishes.
  await expect.poll(()=>page.locator('.dashboard-intro .panel').first().evaluate(el=>getComputedStyle(el).transform)).toBe('none');
});

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

test('serving shortcuts rescale a reviewed food without the keyboard',async({page})=>{
  await page.route('**/api/foods/search?**',route=>route.fulfill({json:[{name:'Boiled egg',calories:155,protein:13,carbs:1.1,fat:11,fiber:0,source:'Open Food Facts',servingGrams:100,portions:[{label:'1 egg',grams:50}],code:null,basis:'per100g'}]}));
  await openFoodLog(page);
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Search term',{exact:true}).fill('egg');
  await page.getByRole('button',{name:'Boiled egg',exact:true}).click();
  const chips=page.getByRole('group',{name:/Quick .* amounts/});
  await expect(chips).toBeVisible();
  await expect(page.locator('.live-calorie-value')).toContainText('78');

  await chips.getByRole('button',{name:'Two servings',exact:true}).click();
  await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue('2');
  await expect(page.locator('.live-calorie-value')).toContainText('155');
  await expect(chips.getByRole('button',{name:'Two servings',exact:true})).toHaveAttribute('aria-pressed','true');
});

import {test,expect,type Page} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';

// Back must unwind the innermost surface first and never leave the app from a
// page, popover, or dialog step. page.goBack() is the same history traversal
// the Android shell performs for its hardware Back button.
let session:Awaited<ReturnType<typeof seedMobileUser>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,'mobile-back-user',[
    {name:'Overnight oats',time:'08:00',calories:410},
    {name:'Chicken rice bowl',time:'13:00',calories:620},
  ]);
});

test.beforeEach(async({context,page})=>{
  await context.addCookies(session.cookies);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
});

const heading=(page:Page,name:string)=>page.getByRole('heading',{name,exact:true,level:1});

test('Back returns through visited pages to the Dashboard',async({page})=>{
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(heading(page,'Food Log')).toBeVisible();
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await expect(heading(page,'Progress')).toBeVisible();

  await page.goBack();
  await expect(heading(page,'Food Log')).toBeVisible();
  await page.goBack();
  await expect(heading(page,'Dashboard')).toBeVisible();
});

test('Back leaves selection mode before it leaves the Food Log',async({page})=>{
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await page.getByRole('button',{name:'Select food entries',exact:true}).click();
  await expect(page.getByRole('button',{name:'Done selecting',exact:true})).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('button',{name:'Select food entries',exact:true})).toBeVisible();
  await expect(heading(page,'Food Log')).toBeVisible();

  await page.goBack();
  await expect(heading(page,'Dashboard')).toBeVisible();
});

test('Back steps out of a food dialog step before closing the dialog',async({page})=>{
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  const logDialog=page.getByRole('dialog',{name:'Log food',exact:true});
  await expect(logDialog).toBeVisible();
  await logDialog.getByRole('button',{name:'Quick add',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Quick add',exact:true})).toBeVisible();

  await page.goBack();
  await expect(logDialog).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(heading(page,'Food Log')).toBeVisible();
});

test('Back closes an open date popover without leaving the page',async({page})=>{
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await page.getByRole('button',{name:'Choose food date',exact:true}).click();
  const calendar=page.getByRole('dialog',{name:'Food date',exact:true});
  await expect(calendar).toBeVisible();

  await page.goBack();
  await expect(calendar).toBeHidden();
  await expect(heading(page,'Food Log')).toBeVisible();
});

test('a weigh-in is only deleted after confirmation',async({page})=>{
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  const rows=page.locator('.weight-history .history-row');
  await expect(rows.first()).toBeVisible();
  const before=await rows.count();

  await rows.first().getByRole('button',{name:'Delete',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'Delete weigh-in',exact:true});
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(confirm).toBeHidden();
  await expect(rows).toHaveCount(before);

  await rows.first().getByRole('button',{name:'Delete',exact:true}).click();
  await page.getByRole('dialog',{name:'Delete weigh-in',exact:true}).getByRole('button',{name:'Delete',exact:true}).click();
  await expect(rows).toHaveCount(before-1);
});

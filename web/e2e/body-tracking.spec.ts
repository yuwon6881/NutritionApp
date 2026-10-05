import {test,expect,type Page} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';
import {mockBodyRecords} from './helpers/bodyRecords';

let session:Awaited<ReturnType<typeof seedMobileUser>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,'body-tracking-user',[]);
});

test.beforeEach(async({context,page})=>{
  await context.addCookies(session.cookies);
  await mockBodyRecords(page);
});

async function openNewestRecord(page:Page){
  await page.goto('/');
  await page.getByRole('button',{name:'Progress',exact:true}).first().click();
  await page.getByRole('button',{name:'Body',exact:true}).click();
  await page.getByRole('button',{name:'Open history',exact:true}).click();
  await page.getByRole('button',{name:/^2026-09-26/}).click();
  await expect(page.getByRole('heading',{name:'Body record',exact:true})).toBeVisible();
}

test('record viewer steps between cycles with buttons and arrow keys, keeping the angle',async({page})=>{
  await openNewestRecord(page);
  const navigation=page.getByRole('navigation',{name:'Record navigation'});
  await expect(navigation).toContainText('2026-09-26');await expect(navigation).toContainText('Record 1 of 4');
  await expect(page.getByRole('button',{name:'Newer record',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Side',exact:true}).click();
  await page.getByRole('button',{name:'Older record',exact:true}).click();
  await expect(navigation).toContainText('2026-09-05');
  await expect(page.getByRole('button',{name:'Side',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByText('Not uploaded',{exact:true})).toBeVisible();

  const frame=page.getByRole('group',{name:/Side physique photo from 2026-09-05/});
  await frame.focus();await page.keyboard.press('ArrowRight');
  await expect(navigation).toContainText('2026-09-26');
  await expect(page.getByRole('img',{name:'Side physique photo from 2026-09-26'})).toBeVisible();
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');
  await expect(navigation).toContainText('2026-07-20');
  await expect(page.getByRole('button',{name:'Older record',exact:true})).toBeDisabled();
});

test('compare pickers step one record at a time and keep one Back button',async({page})=>{
  await openNewestRecord(page);
  await page.getByRole('button',{name:'Compare',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Side-by-side comparison',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Back',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Older past record',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Newer past record',exact:true}).click();
  await expect(page.getByText('Change from 2026-08-15 to 2026-09-26.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Newer present record',exact:true})).toBeDisabled();
  for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  }
  await page.getByRole('button',{name:'Back to Body history',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Body history',exact:true})).toBeVisible();
});

test('AI body-fat estimate needs three photos and fills the field only when used',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Progress',exact:true}).first().click();
  await page.getByRole('button',{name:'Body',exact:true}).click();
  await page.getByRole('button',{name:'Add body record',exact:true}).click();
  const add=page.getByRole('dialog',{name:'Add Body record'});
  await expect(add.getByRole('button',{name:'Estimate with AI',exact:true})).toBeDisabled();
  await expect(add.getByText('Add front, side, and back photos to estimate.',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button',{name:'Open history',exact:true}).click();
  await page.getByRole('button',{name:'Edit',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'Edit Body record'});
  const estimate=dialog.getByRole('button',{name:'Estimate with AI',exact:true});
  await expect(estimate).toBeEnabled();
  const request=page.waitForRequest('**/api/body-records/body-fat-estimate');
  await estimate.click();
  const body=(await request).postDataJSON();
  expect(body.photos).toEqual([{angle:'front',photoId:'body-newest-front'},{angle:'side',photoId:'body-newest-side'},{angle:'back',photoId:'body-newest-back'}]);
  expect(body.measurements).toEqual({neckCm:37.5,waistCm:81,hipsCm:96});
  await expect(dialog.getByRole('heading',{name:'AI estimate: 17.5%'})).toBeFocused();
  await expect(dialog.getByText('Likely 15.5–19.5% · Medium confidence',{exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Body fat (%)',{exact:true})).toHaveValue('18.5');
  await dialog.getByRole('button',{name:'Use 17.5%',exact:true}).click();
  await expect(dialog.getByLabel('Body fat (%)',{exact:true})).toHaveValue('17.5');
  await dialog.getByLabel('Waist (cm)',{exact:true}).fill('80');
  await expect(dialog.getByText(/Based on earlier data/)).toBeVisible();
});

test('AI body-fat estimate errors stay beside the action and keep manual entry available',async({page})=>{
  await page.route('**/api/body-records/body-fat-estimate',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({message:'The photos could not be assessed. Use clear, well-lit front, side, and back photos.'})}));
  await openNewestRecord(page);
  await page.getByRole('button',{name:'Edit record',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit Body record'});
  await dialog.getByRole('button',{name:'Estimate with AI',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('The photos could not be assessed.');
  await dialog.getByLabel('Body fat (%)',{exact:true}).fill('19');
  await expect(dialog.getByLabel('Body fat (%)',{exact:true})).toHaveValue('19');
});

test('changing only a weight-snapshot omission requires dirty dismissal confirmation',async({page})=>{
  await openNewestRecord(page);await page.getByRole('button',{name:'Edit record',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit Body record'});
  await dialog.getByRole('switch',{name:'Omit scale snapshot'}).click();await page.keyboard.press('Escape');
  await expect(page.getByRole('heading',{name:'Discard changes?',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(dialog).toBeVisible();
});

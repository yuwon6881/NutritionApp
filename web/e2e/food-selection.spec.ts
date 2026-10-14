import {test,expect,type APIRequestContext} from '@playwright/test';
import {seedMobileUser,todayInTestZone} from './helpers/seed';
import {randomUUID} from 'node:crypto';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,'test-selection',[
    {name:'Labelled packaged food',time:'09:54',calories:380},
    {name:'Banana, raw',time:'12:18',calories:122},
  ]);
  // A long portion label must not push the macros out of line with the shorter ones.
  const saved=await request.post('/api/sync',{headers:{Origin:origin,'X-Nutrition-Request':'1'},data:{
    id:randomUUID(),kind:'entry',recordId:randomUUID(),expectedRevision:0,delete:false,data:{
      date:todayInTestZone(),name:'White Rice',calories:469,protein:9.7,carbs:101.4,fat:1,fiber:1,quantity:2.3,unit:'serving',portionLabel:'cup cooked',portionGrams:158,time:'15:31',
    }
  }});
  expect(saved.ok(),await saved.text()).toBeTruthy();
});

for(const width of [768,1280])test(`bulk selection at ${width}px keeps the checkbox clear of the name, aligns macros, and Edit opens the editor`,async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.setViewportSize({width,height:900});
  await page.goto('/');
  await page.getByRole('button',{name:'Food Log'}).first().click();
  // A dialog opened and closed once has loaded its code, so Edit opens it without delay.
  await page.getByRole('button',{name:'Log food'}).first().click();
  await expect(page.getByRole('dialog',{name:'Log food',exact:true})).toBeVisible();
  await page.getByRole('dialog',{name:'Log food',exact:true}).getByRole('button',{name:'Close'}).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const macroColumn=async(name:string,letter:string)=>{
    const box=await page.locator('.food-time-card').filter({hasText:name}).locator(`.food-macro.${letter}`).boundingBox();
    return Math.round(box!.x);
  };
  const before={labelled:await macroColumn('Labelled packaged food','protein'),rice:await macroColumn('White Rice','protein'),banana:await macroColumn('Banana, raw','protein')};
  expect(before.rice).toBe(before.labelled);
  expect(before.banana).toBe(before.labelled);

  await page.getByRole('button',{name:'Day options'}).first().click();
  await page.getByRole('menuitem',{name:'Bulk select'}).click();
  // Clicking the real checkbox fails if the name sits on top of it.
  await page.getByRole('checkbox',{name:'Select Labelled packaged food'}).click();
  const checkbox=await page.getByRole('checkbox',{name:'Select Labelled packaged food'}).boundingBox();
  const title=await page.locator('.food-time-card').filter({hasText:'Labelled packaged food'}).locator('.food-time-card-title-text').boundingBox();
  expect(checkbox!.x+checkbox!.width).toBeLessThanOrEqual(title!.x);
  expect(await macroColumn('Labelled packaged food','protein')).toBe(before.labelled);

  await page.getByRole('button',{name:'Edit selected food'}).click();
  const editor=page.getByRole('dialog',{name:'Edit food',exact:true});
  await expect(editor).toBeVisible();
  await page.waitForTimeout(500);
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Food name')).toHaveValue('Labelled packaged food');
});

import {test,expect} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';

// The in-page barcode camera is a dialog nested in Log food. Closing it must not leave a
// history entry that a later Back guard (the photo chooser) mistakes for leaving Log food.
let session:Awaited<ReturnType<typeof seedMobileUser>>;
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']},permissions:['camera']});
test.beforeAll(async({request})=>{session=await seedMobileUser(request,'barcode-label-user',[{name:'Overnight oats',time:'08:00',calories:410}]);});
test.beforeEach(async({context})=>{await context.addCookies(session.cookies);});

test('a label photo after an unknown barcode keeps Log food open',async({page})=>{
  await page.route('**/api/foods/barcode/**',route=>route.fulfill({status:404,json:{title:'Not found'}}));
  await page.route('**/api/scans',route=>{const input=route.request().postDataJSON();return route.fulfill({json:{id:input.id,status:'complete',resultJson:JSON.stringify({foods:[{name:'Label yoghurt',quantity:100,unit:'g',calories:120,protein:6,carbs:15,fat:4,fiber:null,notes:'Per 100 g'}],questions:[],explanation:'Review.'})}});});
  await page.goto('/');
  await page.getByRole('button',{name:'Add entry',exact:true}).click();
  await page.getByRole('button',{name:'Scan food or label',exact:true}).click();
  const logFood=page.getByRole('dialog',{name:'Log food',exact:true});
  await logFood.getByRole('button',{name:'Scan barcode with camera'}).click();
  const camera=page.getByRole('dialog',{name:'Scan barcode',exact:true});
  await expect(camera).toBeVisible();
  // The corner brackets sit on the frame's rounded edge, not outside it.
  const frame=await camera.locator('.barcode-frame').boundingBox();
  const corner=await camera.locator('.barcode-frame>i').first().boundingBox();
  expect(Math.abs(corner!.x-frame!.x)).toBeLessThan(1);
  expect(Math.abs(corner!.y-frame!.y)).toBeLessThan(1);
  await camera.getByRole('button',{name:'Stop barcode camera'}).click();
  await expect(camera).toHaveCount(0);

  const digits=logFood.getByLabel('Barcode digits',{exact:true});
  await digits.fill('5012345678900');
  await digits.press('Enter');
  await logFood.getByRole('button',{name:'Scan nutrition label',exact:true}).click();
  await expect(logFood.getByRole('button',{name:'Back to barcode'})).toBeVisible();

  const chooser=page.waitForEvent('filechooser');
  await logFood.getByRole('button',{name:'Take photo',exact:true}).click();
  await (await chooser).setFiles('public/icon-512.png');
  // Returning from the camera app focuses the window, which releases the Back guard.
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(logFood.locator('.ai-photo-preview img')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(logFood).toBeVisible();

  // Remove shares the caption's row on its trailing edge.
  const bar=await logFood.locator('.ai-photo-preview-bar').boundingBox();
  const remove=await logFood.getByRole('button',{name:'Remove photo'}).boundingBox();
  expect(bar!.x+bar!.width-(remove!.x+remove!.width)).toBeLessThan(16);

  // One Back still leaves Log food: the camera dialog left no entry behind.
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

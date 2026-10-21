import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from './signIn';
import {
  assertActionClickable,
  assertContained,
  assertDialogBodyScroll,
  assertDialogScrollContained,
  assertMacroLayout,
  assertMobileNavFit,
  assertPanelsFitViewport,
  assertProgressTabsVisibility,
  captureBoundary,
  waitSettled,
} from './helpers/boundary-support';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

const BOUNDARY_WIDTHS=[320,360,639,640,899,900,1023,1024,1280,1920] as const;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const response=await signInApi(request,'boundary-user');
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const save=async(kind:string,data:unknown,recordId=randomUUID())=>{
    const saved=await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId,expectedRevision:0,delete:false,data}});
    expect(saved.ok(),await saved.text()).toBeTruthy();
  };
  await save('profile',{
    dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,
    goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0,
  },state.id);
  const preview=await (await request.get('/api/coach/preview')).json();
  expect((await request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}})).ok()).toBeTruthy();
  const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(let offset=13;offset>=0;offset--){
    const day=new Date(`${current}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-offset);
    const date=day.toISOString().slice(0,10);
    await save('weight',{date,kg:80.5+offset*.06+(offset%3)*.12});
    await save('entry',{date,name:'Greek yogurt, berries and rolled oats',calories:420,protein:28,carbs:52,fat:12,fiber:7,quantity:1,unit:'serving',time:'08:00'});
  }
  await save('entry',{date:current,name:'Grilled chicken with brown rice and vegetables',calories:640,protein:46,carbs:68,fat:18,fiber:9,quantity:1,unit:'serving',time:'12:30'});
  session=await request.storageState();
});

for(const width of BOUNDARY_WIDTHS)for(const theme of ['light','dark'] as const){
  test(`${theme} ${width}px boundary: main pages and sections presentation`,async({page,context})=>{
    test.setTimeout(120000);
    await context.addCookies(session.cookies);
    await page.setViewportSize({width,height:900});
    await page.addInitScript(t=>localStorage.setItem('nutrition-theme',t),theme);
    await page.goto('/');

    await expect(page.locator('.account-name')).toHaveText('boundary-user');
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
    await expect(page.locator('.energy-ring')).not.toHaveClass(/energy-ring-intro/);
    await expect(page.locator('.energy-ring .ring-value')).toHaveText('1,060');
    if(width===640||width===899){
      await assertMacroLayout(page);
    }
    await waitSettled(page);
    await assertContained(page);
    await assertPanelsFitViewport(page);
    await assertMobileNavFit(page);
    await captureBoundary(page,`${theme}-${width}-Dashboard`);

    for(const name of ['Food Log','Progress','Coach','Settings'] as const){
      await page.getByRole('button',{name,exact:true}).click();
      await expect(page.locator('[data-page-heading]')).toHaveText(name);

      if(name==='Food Log'){
        await expect(page.locator('[data-time-row="08:00"]')).toBeVisible();
        await expect(page.locator('.food-day-skeleton, [aria-busy="true"].food-day-summary')).toHaveCount(0);
      }
      if(name==='Progress'){
        await expect(page.locator('.stats-grid:not(.skeleton)')).toBeVisible();
        await expect(page.locator('.skeleton[aria-busy="true"]')).toHaveCount(0);
      }
      if(name==='Coach'){
        await expect(page.locator('.target-figures')).toBeVisible();
        await expect(page.locator('.strategy-figures')).toBeVisible();
      }
      if(name==='Settings'){
        await expect(page.locator('.settings-account-name')).toBeVisible();
      }

      await waitSettled(page);
      await assertContained(page);
      await assertPanelsFitViewport(page);
      await assertMobileNavFit(page);
      await captureBoundary(page,`${theme}-${width}-${name.replaceAll(' ','-')}`);
    }

    await page.getByRole('button',{name:'Progress',exact:true}).click();
    await expect(page.locator('[data-page-heading]')).toHaveText('Progress');
    await assertProgressTabsVisibility(page);
    await assertMobileNavFit(page);
    for(const section of ['Energy','Body','Activity'] as const){
      await page.getByRole('button',{name:section,exact:true}).click();
      await assertProgressTabsVisibility(page);
      if(section==='Energy'){
        await expect(page.locator('.energy-stats')).toBeVisible();
        await expect(page.locator('.energy-readout')).toBeVisible();
        await expect(page.locator('.energy-history .skeleton[aria-busy="true"], [role="status"][aria-busy="true"]')).toHaveCount(0);
      }
      if(section==='Body'){
        await expect(page.getByRole('button',{name:'Add photo set',exact:true})).toBeVisible();
        await expect(page.locator('.body-hub-skeleton, .physique-photo-home[aria-busy="true"]')).toHaveCount(0);
      }
      if(section==='Activity'){
        await expect(page.locator('.activity-progress-hub')).toBeVisible();
      }
      await waitSettled(page);
      await assertContained(page);
      await assertPanelsFitViewport(page);
      await assertMobileNavFit(page);
      await captureBoundary(page,`${theme}-${width}-Progress-${section}`);
    }

    await page.getByRole('button',{name:'Coach',exact:true}).click();
    await expect(page.locator('[data-page-heading]')).toHaveText('Coach');
    await assertMobileNavFit(page);
    await page.getByRole('button',{name:'Edit plan',exact:true}).click();
    await expect(page.locator('.coach-plan-heading h2')).toBeVisible();
    await waitSettled(page);
    await assertContained(page);
    await assertPanelsFitViewport(page);
    await assertMobileNavFit(page);
    await captureBoundary(page,`${theme}-${width}-Coach-Plan`);

    await page.getByRole('button',{name:'Targets',exact:true}).click();
    await page.getByRole('button',{name:'History',exact:true}).click();
    const historyHeading=page.getByRole('heading',{name:'Goal history',exact:true});
    await expect(historyHeading).toBeVisible();
    const historyPanel=historyHeading.locator('xpath=ancestor::section[contains(@class,"panel")]');
    await expect(historyPanel.locator('.goal-history-list, .empty')).toBeVisible();
    await waitSettled(page);
    await assertContained(page);
    await assertPanelsFitViewport(page);
    await assertMobileNavFit(page);
    await captureBoundary(page,`${theme}-${width}-Coach-History`);
  });
}

test('narrow food selection, recent food review, manual editor and batch review',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.setViewportSize({width:320,height:800});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();

  const launcher=page.getByRole('button',{name:'Add entry',exact:true});
  await launcher.click();
  const addSheet=page.getByRole('dialog',{name:'Add',exact:true});
  await expect(addSheet).toBeVisible();
  await assertContained(page);

  await addSheet.getByRole('button',{name:'Log food'}).click();
  const foodDialog=page.getByRole('dialog',{name:'Log food',exact:true});
  await expect(foodDialog).toBeVisible();
  await assertContained(page);
  await assertDialogScrollContained(page);
  await captureBoundary(page,'320-food-selection-dialog');

  const recentFood=foodDialog.locator('button.recent-food-card').first();
  await expect(recentFood).toBeVisible();
  await recentFood.click();

  const recentReview=page.getByRole('dialog',{name:'Review food',exact:true});
  await expect(recentReview).toBeVisible();
  await assertContained(page);
  await assertDialogScrollContained(page);
  await captureBoundary(page,'320-recent-food-review-dialog');
  await recentReview.getByRole('button',{name:'Add to batch',exact:true}).click();

  const batchDialog=page.getByRole('dialog',{name:/^Batch \(/});
  await expect(batchDialog).toBeVisible();
  await assertContained(page);
  await assertDialogScrollContained(page);
  await captureBoundary(page,'320-batch-review-dialog');

  await batchDialog.getByRole('button',{name:'Add more food'}).click();
  await expect(foodDialog).toBeVisible();
  await foodDialog.getByRole('button',{name:'Manual entry',exact:true}).click();
  const reviewDialog=page.getByRole('dialog',{name:'Review food',exact:true});
  await expect(reviewDialog).toBeVisible();
  await expect(reviewDialog.getByLabel('Food name')).toBeVisible();
  await assertContained(page);
  await assertDialogScrollContained(page);
  await captureBoundary(page,'320-manual-entry-dialog');

  await page.keyboard.press('Escape');
  const alertConfirm=page.getByRole('alertdialog');
  if(await alertConfirm.isVisible()){
    await alertConfirm.getByRole('button',{name:'Discard changes'}).click();
  }
  await expect(foodDialog.getByRole('button',{name:'Manual entry',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  if(await page.getByRole('alertdialog').isVisible()){
    await page.getByRole('alertdialog').getByRole('button',{name:'Discard changes'}).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

test('landscape short height 844x390 and 200% text size: dialog reachable and focus restoration',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.setViewportSize({width:844,height:390});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();

  const launcher=page.getByRole('button',{name:'Add entry',exact:true});
  await launcher.click();
  const addSheet=page.getByRole('dialog',{name:'Add',exact:true});
  await expect(addSheet).toBeVisible();

  await addSheet.getByRole('button',{name:'Log weight'}).click();
  const weightDialog=page.getByRole('dialog',{name:'Log weight',exact:true});
  await expect(weightDialog).toBeVisible();
  await assertContained(page);
  await assertDialogBodyScroll(page,weightDialog);
  await assertActionClickable(weightDialog.getByRole('button',{name:'Update weigh-in',exact:true}));

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(launcher).toBeFocused();

  await launcher.click();
  await expect(addSheet).toBeVisible();
  await addSheet.getByRole('button',{name:'Log food'}).click();
  const foodModal=page.getByRole('dialog',{name:'Log food',exact:true});
  await expect(foodModal).toBeVisible();
  await foodModal.getByRole('button',{name:'Manual entry',exact:true}).click();

  const reviewModal=page.getByRole('dialog',{name:'Review food',exact:true});
  await expect(reviewModal).toBeVisible();
  await expect(reviewModal.getByLabel('Food name')).toBeVisible();
  await assertContained(page);
  await assertDialogBodyScroll(page,reviewModal);
  await assertActionClickable(reviewModal.getByRole('button',{name:'Add to batch',exact:true}));

  await page.keyboard.press('Escape');
  if(await page.getByRole('alertdialog').isVisible()){
    await page.getByRole('alertdialog').getByRole('button',{name:'Discard changes'}).click();
  }
  await expect(foodModal.getByRole('button',{name:'Manual entry',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  if(await page.getByRole('alertdialog').isVisible()){
    await page.getByRole('alertdialog').getByRole('button',{name:'Discard changes'}).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(launcher).toBeFocused();

  await page.setViewportSize({width:640,height:800});
  await page.addStyleTag({content:'html{font-size:200%!important}'});
  await assertContained(page);
  await assertMacroLayout(page);
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await expect(page.locator('[data-page-heading]')).toHaveText('Progress');
  await assertProgressTabsVisibility(page);
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();

  await page.setViewportSize({width:360,height:800});
  await assertContained(page);
  await assertMobileNavFit(page);
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await expect(page.locator('[data-page-heading]')).toHaveText('Progress');
  await assertContained(page);
  await assertProgressTabsVisibility(page);
  await captureBoundary(page,'360-text200-Progress-tabs');
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();

  await launcher.click();
  await expect(addSheet).toBeVisible();
  await addSheet.getByRole('button',{name:'Log food'}).click();
  await expect(foodModal).toBeVisible();
  await foodModal.getByRole('button',{name:'Manual entry',exact:true}).click();
  await expect(reviewModal).toBeVisible();
  await expect(reviewModal.getByLabel('Food name')).toBeVisible();
  await assertContained(page);
  await assertDialogBodyScroll(page,reviewModal);
  await assertActionClickable(reviewModal.getByRole('button',{name:'Add to batch',exact:true}));

  await page.keyboard.press('Escape');
  if(await page.getByRole('alertdialog').isVisible()){
    await page.getByRole('alertdialog').getByRole('button',{name:'Discard changes'}).click();
  }
  await expect(foodModal.getByRole('button',{name:'Manual entry',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  if(await page.getByRole('alertdialog').isVisible()){
    await page.getByRole('alertdialog').getByRole('button',{name:'Discard changes'}).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

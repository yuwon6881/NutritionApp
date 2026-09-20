import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signIn} from './signIn';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};

test('Google Health disclosure cancels cleanly and empty history stays readable',async({page})=>{
  await page.route('**/api/integrations/google-health/sync',async route=>{
    await route.fulfill({contentType:'application/json',body:JSON.stringify({
      status:'disconnected',
      connectedAt:null,
      lastSyncedAt:null,
      freshness:'unavailable',
      days:[],
      weightSync:{enabled:false,permissionGranted:false,state:'disabled',pendingCount:0,lastSuccessfulSyncAt:null,revision:0},
    })});
  });
  await signIn(page,'test-alice');

  const state=await (await page.request.get('/api/state')).json();
  if(!state.profile){
    const profile=await page.request.post('/api/sync',{headers,data:{
      id:randomUUID(),
      recordId:state.id,
      kind:'profile',
      expectedRevision:state.profileRevision,
      delete:false,
      data:{
        dateOfBirth:'1996-03-14',
        age:30,
        heightCm:170,
        weightKg:81,
        sex:'female',
        activity:1.4,
        goal:'maintain',
        maintenance:2500,
        timeZone:'Asia/Kuala_Lumpur',
        phaseMode:'open',
        energyAdjustmentPercent:0,
      },
    }});
    expect(profile.ok(),await profile.text()).toBeTruthy();
  }

  await page.goto('/');
  await expect(page.locator('.steps-panel')).toHaveCount(0);
  // The SPA keeps navigation client-side, so use the real Settings control.
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();

  // Fitness Account returns a canceled connection through the central callback.
  // The Connected Apps surface owns that notice and removes the one-shot query.
  await page.goto('/settings?central_error=access_denied');
  await expect(page.getByText('Workout connection was canceled.',{exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!new URL(window.location.href).searchParams.has('central_error'))).toBeTruthy();

  const connect=page.getByRole('button',{name:'Connect Google Health',exact:true});
  await connect.click();
  const disclosure=page.getByRole('dialog',{name:'Connect Google Health',exact:true});
  await expect(disclosure).toBeVisible();
  const weightSwitch=disclosure.getByRole('switch',{name:'Sync weight to Google Health'});
  await expect(weightSwitch).not.toBeChecked();
  await weightSwitch.check();
  await expect(weightSwitch).toBeChecked();
  await disclosure.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(disclosure).toHaveCount(0);
  await expect(connect).toBeFocused();

  await page.unroute('**/api/integrations/google-health/sync');
  let forcedSyncs = 0;
  await page.route('**/api/integrations/google-health/sync',async route=>{
    if ((route.request().postDataJSON() as {force?: boolean}).force === true) forcedSyncs++;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({
      status:'connected',
      connectedAt:'2026-09-17T08:00:00Z',
      lastSyncedAt:null,
      freshness:'unavailable',
      days:[],
      weightSync:{enabled:false,permissionGranted:false,state:'disabled',pendingCount:0,lastSuccessfulSyncAt:null,revision:0},
      warningCode:'provider_resource_not_found',
      warningMessage:'Daily step history is unavailable right now.',
    })});
  });
  await page.reload();
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();

  const syncNow = page.getByRole('button',{name:'Sync now',exact:true});
  await syncNow.click();
  await expect.poll(()=>forcedSyncs).toBe(1);
  await expect(syncNow).toHaveText('Sync now');

  const weightSyncRow=page.locator('.google-health-weight-sync .check-row').first();
  const weightSyncTitle=weightSyncRow.locator('strong');
  const weightSyncDescription=weightSyncRow.locator('small');
  await expect(weightSyncRow).toBeVisible();
  await expect(weightSyncDescription).toHaveCSS('display','block');
  const titleBox=await weightSyncTitle.boundingBox();
  const descriptionBox=await weightSyncDescription.boundingBox();
  expect(titleBox && descriptionBox).toBeTruthy();
  expect(descriptionBox!.y).toBeGreaterThanOrEqual(titleBox!.y+titleBox!.height-1);

  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Google Health steps · Last 30 days',exact:true})).toBeVisible();
  await expect(page.getByText('Daily step history is unavailable right now.',{exact:true})).toBeVisible();
  await expect(page.locator('.chart-date-axis')).toHaveCount(0);
  const accessibleSummary=page.locator('.google-health-progress-section .sr-only');
  await expect(accessibleSummary).toHaveCSS('position','absolute');
  await expect(accessibleSummary).toHaveCSS('width','1px');

  await page.getByRole('button',{name:'Dashboard',exact:true}).click();
  await expect(page.locator('.steps-panel')).toBeVisible();
  await expect(page.locator('.steps-panel')).toHaveClass(/steps-panel-compact/);
  const dashboardGrid=await page.locator('.daily-grid').boundingBox();
  const stepsPanel=await page.locator('.steps-panel').boundingBox();
  const trainingSummary=await page.locator('.training-summary').boundingBox();
  expect(dashboardGrid && stepsPanel && trainingSummary).toBeTruthy();
  expect(stepsPanel!.y).toBeGreaterThanOrEqual(dashboardGrid!.y+dashboardGrid!.height-1);
  expect(stepsPanel!.y).toBeLessThan(trainingSummary!.y);
  await expect(page.locator('.steps-panel').getByText('—')).toBeVisible();
  await expect(page.locator('.steps-panel').getByText('Daily step history is unavailable right now.',{exact:true})).toBeVisible();
});

test('Google Health step chart selects a day by click and keyboard',async({page})=>{
  const days=Array.from({length:31},(_,index)=>{
    const date=new Date(Date.UTC(2026,7,19+index)).toISOString().slice(0,10);
    return {date,count:index===30?6500:null};
  });
  await page.route('**/api/integrations/google-health/sync',async route=>{
    await route.fulfill({contentType:'application/json',body:JSON.stringify({
      status:'connected',
      connectedAt:'2026-09-17T08:00:00Z',
      lastSyncedAt:'2026-09-18T08:00:00Z',
      freshness:'fresh',
      days,
      weightSync:{enabled:false,permissionGranted:false,state:'disabled',pendingCount:0,lastSuccessfulSyncAt:null,revision:0},
    })});
  });
  await signIn(page,'test-alice');

  const state=await (await page.request.get('/api/state')).json();
  if(!state.profile){
    const profile=await page.request.post('/api/sync',{headers,data:{
      id:randomUUID(),
      recordId:state.id,
      kind:'profile',
      expectedRevision:state.profileRevision,
      delete:false,
      data:{
        dateOfBirth:'1996-03-14',
        age:30,
        heightCm:170,
        weightKg:81,
        sex:'female',
        activity:1.4,
        goal:'maintain',
        maintenance:2500,
        timeZone:'Asia/Kuala_Lumpur',
        phaseMode:'open',
        energyAdjustmentPercent:0,
      },
    }});
    expect(profile.ok(),await profile.text()).toBeTruthy();
  }

  await page.goto('/');
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Google Health steps · Last 30 days',exact:true})).toBeVisible();

  const missingDay=page.getByRole('button',{name:'2026-08-19: No step data',exact:true});
  await missingDay.click();
  await expect(page.locator('.active-day-preview')).toContainText('2026-08-19');
  await expect(page.locator('.active-day-preview')).toContainText('not recorded');

  const recordedDay=page.getByRole('button',{name:'2026-09-18: 6,500 steps',exact:true});
  await recordedDay.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.active-day-preview')).toContainText('6,500');
});

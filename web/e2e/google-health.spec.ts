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
  // The SPA keeps navigation client-side, so use the real Settings control.
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();

  const connect=page.getByRole('button',{name:'Connect Google Health',exact:true});
  await connect.click();
  const disclosure=page.getByRole('dialog',{name:'Connect Google Health',exact:true});
  await expect(disclosure).toBeVisible();
  await disclosure.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(disclosure).toHaveCount(0);
  await expect(connect).toBeFocused();

  await page.unroute('**/api/integrations/google-health/sync');
  await page.route('**/api/integrations/google-health/sync',async route=>{
    await route.fulfill({contentType:'application/json',body:JSON.stringify({
      status:'connected',
      connectedAt:'2026-09-17T08:00:00Z',
      lastSyncedAt:null,
      freshness:'unavailable',
      days:[],
    })});
  });
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Google Health steps · Last 30 days',exact:true})).toBeVisible();
  await expect(page.getByText('Daily step history is unavailable right now.',{exact:true})).toBeVisible();
  await expect(page.locator('.chart-date-axis')).toHaveCount(0);
  const accessibleSummary=page.locator('.google-health-progress-section .sr-only');
  await expect(accessibleSummary).toHaveCSS('position','absolute');
  await expect(accessibleSummary).toHaveCSS('width','1px');
});

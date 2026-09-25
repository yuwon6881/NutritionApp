import { randomUUID } from 'node:crypto';
import {expect,test,type Page} from '@playwright/test';
import {signIn} from './signIn';

const connectedRoute='**/api/integrations/connected';
const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const requestHeaders={Origin:origin,'X-Nutrition-Request':'1'};

async function openSignedInApp(page: Page) {
  await signIn(page,'test-alice');
  const state=await (await page.request.get('/api/state')).json();
  if(!state.profile){
    const profile=await page.request.post('/api/sync',{headers:requestHeaders,data:{
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
}

async function openConnectedApps(page: Page) {
  await openSignedInApp(page);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Connected Apps',exact:true})).toBeVisible();
}

test('temporary central status keeps Workout connected and shows the generic sync warning',async({page})=>{
  await page.route(connectedRoute,route=>route.fulfill({json:[{
    peer:'workout',
    status:'active',
    connectionState:'temporary_unavailable',
    syncWarning:'Workout training summaries are temporarily unavailable. Try again later.',
    scopes:['workout.training_summary.read'],
    grantedAt:'2026-09-01T00:00:00Z',
    revokedAt:null,
  }]}));
  await openConnectedApps(page);

  await expect(page.getByText('Connected · sync delayed',{exact:true})).toBeVisible();
  await expect(page.getByText('Workout training summaries are temporarily unavailable. Try again later.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Disconnect',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Connect Workout',exact:true})).toHaveCount(0);
});

test('legacy Workout consent asks for an explicit upgrade',async({page})=>{
  await page.route(connectedRoute,route=>route.fulfill({json:[{
    peer:'workout',
    status:'active',
    connectionState:'upgrade_required',
    syncWarning:null,
    scopes:['workout.training_summary.read'],
    grantedAt:'2026-09-01T00:00:00Z',
    revokedAt:null,
  }]}));
  await openConnectedApps(page);

  await expect(page.getByText('Reconnect once to upgrade this older Workout connection to permanent consent.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Upgrade connection',exact:true})).toBeVisible();
});

test('status request failure does not appear as disconnected',async({page})=>{
  await page.route(connectedRoute,route=>route.fulfill({status:503,json:{message:'Status unavailable.'}}));
  await openConnectedApps(page);

  await expect(page.getByText('Connected apps unavailable',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Connect Workout',exact:true})).toHaveCount(0);
});

test('dashboard loads Workout summaries once instead of re-fetching after each response',async({page})=>{
  let requests=0;
  // Each response carries a new payload and no validator, exactly what a refreshed cache returns.
  await page.route('**/api/training/summary',route=>{
    requests+=1;
    return route.fulfill({json:{summaries:[],workoutConnected:true,workoutWarning:null,request:requests}});
  });
  await openSignedInApp(page);
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect.poll(()=>requests).toBeGreaterThan(0);
  await page.waitForTimeout(3000);

  expect(requests).toBeLessThanOrEqual(2);
});

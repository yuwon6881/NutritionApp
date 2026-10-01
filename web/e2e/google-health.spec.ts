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
  const dataSwitch=disclosure.getByRole('switch',{name:'Sync health & nutrition data'});
  await expect(dataSwitch).toBeChecked();
  await dataSwitch.uncheck();
  await expect(dataSwitch).not.toBeChecked();
  await dataSwitch.check();
  await expect(dataSwitch).toBeChecked();
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
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Google Health steps · Last 30 days',exact:true})).toBeVisible();
  await expect(page.getByText('Step history unavailable.',{exact:true})).toBeVisible();
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
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Google Health steps · Last 30 days',exact:true})).toBeVisible();

  // The readout always holds a day (the latest first), so selecting never moves the chart.
  const readout=page.locator('.step-chart .chart-readout');
  await expect(readout).toContainText('Sep 18, 2026');
  await expect(readout).toContainText('6,500');
  const readoutBox=await readout.boundingBox();

  const chart=page.getByRole('group',{name:/Step chart\. Tap a bar/});
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(readout).toContainText('Aug 19, 2026');
  await expect(readout).toContainText('Not recorded');

  // Home scrolled the first days into view; a click on the second slot selects that day.
  const plot=page.getByRole('img',{name:/Daily step counts/});
  const scroller=page.locator('.step-chart .bar-chart-scroller');
  const slot=(await plot.boundingBox())!.width/31;
  const view=(await scroller.boundingBox())!;
  await page.mouse.click(view.x+slot*1.5,view.y+60);
  await expect(readout).toContainText('Aug 20, 2026');

  await page.keyboard.press('End');
  await expect(readout).toContainText('6,500');
  // Page scrolling may move it; its height must not change with the selected day.
  expect((await readout.boundingBox())!.height).toBe(readoutBox!.height);
});

for (const width of [390,768,1440]) for (const theme of ['light','dark']) {
  test(`delayed steps reveal remains usable at ${width}px in ${theme}`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.addInitScript(()=>{
      const original=Element.prototype.animate;
      (window as unknown as {stepReveals:number}).stepReveals=0;
      Element.prototype.animate=function(...args:Parameters<typeof original>){
        if((this as HTMLElement).dataset.motionPanel==='dashboard-steps')
          (window as unknown as {stepReveals:number}).stepReveals++;
        return original.apply(this,args);
      };
    });
    await page.route('**/api/integrations/google-health/sync',async route=>{
      await new Promise(resolve=>setTimeout(resolve,250));
      await route.fulfill({json:{status:'connected',connectedAt:'2026-09-17T08:00:00Z',lastSyncedAt:null,freshness:'fresh',days:[]}});
    });
    await signIn(page,'test-alice');
    await page.goto('/');
    await expect(page.locator('.steps-panel')).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {stepReveals:number}).stepReveals)).toBe(1);
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const panel=page.locator('.dashboard-steps-reveal');
    await expect.poll(()=>panel.evaluate(node=>node.getAnimations().length)).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    const calculator=page.locator('.steps-panel').getByRole('button',{name:/Steps calculator/i});
    await calculator.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(calculator).toBeFocused();
    await page.screenshot({path:testInfo.outputPath(`steps-${width}-${theme}.png`),fullPage:true});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.reload();
    await expect(page.locator('.steps-panel')).toBeVisible();
    expect(await page.evaluate(()=>(window as unknown as {stepReveals:number}).stepReveals)).toBe(0);
  });
}

test('Google Health recovers after a gateway 429 on reload',async({page})=>{
  let requests=0;
  await page.route('**/api/integrations/google-health/sync',async route=>{
    requests++;
    if(requests===1){await route.fulfill({status:429,body:'No available instance'});return;}
    await route.fulfill({json:{status:'connected',connectedAt:'2026-09-17T08:00:00Z',lastSyncedAt:null,freshness:'fresh',days:[]}});
  });
  await signIn(page,'test-alice');
  await expect(page.locator('.steps-panel')).toBeVisible();
  expect(requests).toBe(2);
});

test('connection feedback retries bootstrap with an empty outbox',async({page},testInfo)=>{
  await signIn(page,'test-alice');
  const saved=await (await page.request.get('/api/bootstrap')).json();
  let available=false;
  let reads=0;
  await page.route('**/api/bootstrap',async route=>{
    reads++;
    await route.fulfill(available?{json:saved}:{status:503,body:'Service unavailable'});
  });
  await page.reload();
  const feedback=page.locator('.card-feedback').filter({hasText:'Connection needs attention'});
  await expect(feedback).toBeVisible();
  for(const width of [390,768,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const retry=feedback.getByRole('button',{name:'Retry connection',exact:true});
    await retry.scrollIntoViewIfNeeded();
    const box=(await retry.boundingBox())!;
    if(width<1024)expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await retry.evaluate(node=>{const box=node.getBoundingClientRect();return node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));})).toBeTruthy();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    await page.screenshot({path:testInfo.outputPath(`connection-${width}-${theme}.png`),fullPage:true});
  }
  const before=reads;
  available=true;
  await feedback.getByRole('button',{name:'Retry connection',exact:true}).click();
  await expect.poll(()=>reads).toBeGreaterThan(before);
  await expect(feedback).toHaveCount(0);
});

test('a failed manual step refresh keeps the previous step total visible',async({page})=>{
  let failing=false;
  await page.route('**/api/integrations/google-health/sync',async route=>{
    if(failing){await route.fulfill({status:503,body:'Service unavailable'});return;}
    const date=new Date().toISOString().slice(0,10);
    await route.fulfill({json:{status:'connected',connectedAt:'2026-09-17T08:00:00Z',lastSyncedAt:null,freshness:'fresh',days:[{date,count:5300}]}});
  });
  await signIn(page,'test-alice');
  await expect(page.locator('.steps-panel')).toContainText('5,300');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  failing=true;
  await page.getByRole('button',{name:'Sync now',exact:true}).click();
  await expect(page.getByText('Step sync unavailable',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();
  await expect(page.locator('.steps-panel')).toContainText('5,300');
  await expect(page.locator('.steps-panel')).toContainText('Stale');
});

test('Retry sync immediately dispatches requeued health uploads',async({page})=>{
  let recovered=false;
  let forced=0;
  const item={enabled:true,permissionGranted:true,state:'idle',pendingCount:0,lastSuccessfulSyncAt:null,revision:1};
  await page.route('**/api/integrations/google-health/sync',async route=>{
    if(route.request().postDataJSON().force)forced++;
    await route.fulfill({json:{status:'connected',connectedAt:'2026-09-17T08:00:00Z',lastSyncedAt:null,freshness:'fresh',days:[],
      weightSync:recovered?{...item,lastSuccessfulSyncAt:'2026-10-01T08:00:00Z'}:{...item,state:'failed',failureMessage:'Weight upload was interrupted.'},
      nutritionSync:item,bodyFatSync:item}});
  });
  await page.route('**/api/integrations/google-health/weight-sync/recover',async route=>{
    recovered=true;
    await route.fulfill({json:{...item,state:'pending',pendingCount:1}});
  });
  await signIn(page,'test-alice');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const feedback=page.locator('.card-feedback').filter({hasText:'Weight upload was interrupted.'});
  await expect(feedback).toBeVisible();
  await feedback.getByRole('button',{name:'Retry sync',exact:true}).click();
  await expect.poll(()=>forced).toBe(1);
  await expect(page.locator('.google-health-weight-sync')).toContainText('Last sync:');
  await expect(feedback).toHaveCount(0);
});

test('weigh-in import is offered at connect and turning it off keeps imported weigh-ins',async({page})=>{
  const item={enabled:false,permissionGranted:true,state:'disabled',pendingCount:0,lastSuccessfulSyncAt:null,revision:1};
  let weightImport={enabled:true,permissionGranted:true,state:'idle',lastSuccessAt:'2026-10-01T08:00:00Z',lastImportedCount:2,revision:3};
  let status='disconnected';
  const preferences:unknown[]=[];
  await page.route('**/api/integrations/google-health/sync',async route=>{
    await route.fulfill({json:{status,connectedAt:status==='connected'?'2026-09-17T08:00:00Z':null,lastSyncedAt:null,
      freshness:status==='connected'?'fresh':'unavailable',days:[],weightSync:item,nutritionSync:item,bodyFatSync:item,weightImport}});
  });
  await page.route('**/api/integrations/google-health/weight-import/preference',async route=>{
    preferences.push(route.request().postDataJSON());
    weightImport={...weightImport,enabled:false,state:'disabled',revision:4};
    await route.fulfill({json:weightImport});
  });
  await signIn(page,'test-alice');
  await page.getByRole('button',{name:'Settings',exact:true}).click();

  await page.getByRole('button',{name:'Connect Google Health',exact:true}).click();
  const disclosure=page.getByRole('dialog',{name:'Connect Google Health',exact:true});
  await expect(disclosure.getByRole('switch',{name:'Import weigh-ins from Google Health'})).toBeChecked();
  await disclosure.getByRole('button',{name:'Cancel',exact:true}).click();

  status='connected';
  await page.reload();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const section=page.locator('.google-health-weight-import');
  const importSwitch=section.getByRole('switch',{name:'Import weigh-ins from Google Health'});
  await expect(importSwitch).toBeChecked();
  await expect(section).toContainText('2 weigh-ins added.');
  await expect(section).toContainText('weigh-ins already imported stay');

  // The switch reflects the saved preference, so it flips only after the server answers.
  await importSwitch.click();
  await expect.poll(()=>preferences).toEqual([{enabled:false,revision:3}]);
  await expect(importSwitch).not.toBeChecked();
  await expect(section).toContainText('Your own entries always win.');
});

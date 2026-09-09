import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const headers={Origin:process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088','X-Nutrition-Request':'1'};
const profile={dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',goalRatePercent:0,distributionShares:null,energyAdjustmentPercent:0};
test.use({video:'on'});
test.setTimeout(120000);
test.describe.configure({mode:'serial'});
test.beforeEach(async({page,context})=>{
  expect((await context.request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const credentials={username:'coach-motion',password:'nutrition test password 2026'};
  let registered=await context.request.post('/api/auth/register',{headers,data:credentials});
  for(let i=0;registered.status()===429&&i<12;i++){
    await new Promise(resolve=>setTimeout(resolve,5000));
    registered=await context.request.post('/api/auth/register',{headers,data:credentials});
  }
  expect(registered.ok()).toBeTruthy();
  const state=await (await context.request.get('/api/state')).json();
  expect((await context.request.post('/api/sync',{headers,data:{id:randomUUID(),kind:'profile',recordId:state.id,expectedRevision:0,data:profile}})).ok()).toBeTruthy();
  const preview=await (await context.request.get('/api/coach/preview')).json();
  expect((await context.request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}})).ok()).toBeTruthy();
  await page.goto('/');await page.getByRole('button',{name:'Coach',exact:true}).click();
});
async function settled(page:Page){
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
}
async function step(page:Page,name:string){
  await page.getByRole('button',{name:new RegExp(`\\d\\. ${name}`)}).click();
  await expect(page.locator('[data-step-heading]')).toHaveText(name);await settled(page);
}
async function changeGoal(page:Page){
  await page.getByRole('button',{name:'Plan',exact:true}).click();await step(page,'Goal');
  await page.getByRole('radio',{name:'Fat loss',exact:true}).check();
  await step(page,'Macros');await page.getByRole('button',{name:'Save profile',exact:true}).click();
}
async function transitionFrames(page:Page,name:string){
  return page.getByRole('button',{name,exact:true}).evaluate(button=>new Promise<string[]>(resolve=>{
    const stage=document.querySelector('.coach-step-stage')!;
    const observer=new MutationObserver(()=>{
      observer.disconnect();
      const animations=stage.getAnimations();
      const transforms=animations.flatMap(a=>(a.effect as KeyframeEffect).getKeyframes()).map(k=>String(k.transform));
      for(const animation of animations){animation.pause();animation.currentTime=Number(animation.effect!.getTiming().duration)/2;}
      resolve(transforms);
    });
    observer.observe(stage,{attributes:true,attributeFilter:['data-step']});
    (button as HTMLButtonElement).click();
  }));
}

test('directional navigation, interrupted exits, focus, layouts and reduced motion',async({page})=>{
  test.setTimeout(120000);
  await page.getByRole('button',{name:'Plan',exact:true}).click();
  for(const theme of ['light','dark'])for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    for(const name of ['Body','Activity','Goal','Macros']){
      await step(page,name);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
      if(width<1024)expect(await page.locator('.coach-tab-scene button:visible').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height<43).map(n=>n.textContent))).toEqual([]);
      await page.screenshot({path:`artifacts/coach-${theme}-${width}-${name}.png`,fullPage:true});
      if(name==='Body'){
        await page.locator('.custom-date-trigger').click();
        const calendar=page.getByRole('dialog',{name:'Date of birth'});await expect(calendar).toBeVisible();
        const bounds=await calendar.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
        await page.getByRole('button',{name:'Close',exact:true}).click();
      }
      if(name==='Goal'){
        await page.getByRole('radio',{name:'Fat loss',exact:true}).check();
        await page.getByLabel('Track my goal by',{exact:true}).selectOption('duration');await settled(page);
        await expect(page.getByLabel('Phase length (weeks)')).toBeVisible();
        await page.getByLabel('Track my goal by',{exact:true}).selectOption('weight');await settled(page);
        await page.getByLabel('Target weight (kg)',{exact:true}).fill('75');
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
        await page.screenshot({path:`artifacts/coach-${theme}-${width}-weight-goal.png`,fullPage:true});
        await page.getByRole('radio',{name:'Maintenance',exact:true}).check();
      }
    }
  }
  await step(page,'Body');
  await page.getByLabel('Starting weight (kg)').fill('82.5');
  // Capture keyframes before the short animations finish; positive is forward, negative back.
  expect(await transitionFrames(page,'Next: Activity')).toContain('translateX(24px)');
  await expect(page.locator('[data-step-heading]')).toHaveText('Activity');
  await page.screenshot({path:'artifacts/coach-forward-midpoint.png',fullPage:true,animations:'allow'});
  await page.locator('.coach-step-stage').evaluate(node=>node.getAnimations().forEach(a=>a.finish()));
  await settled(page);
  expect(await transitionFrames(page,'Back')).toContain('translateX(-24px)');
  await expect(page.locator('[data-step-heading]')).toHaveText('Body');
  await page.screenshot({path:'artifacts/coach-back-midpoint.png',fullPage:true,animations:'allow'});
  await page.locator('.coach-step-stage').evaluate(node=>node.getAnimations().forEach(a=>a.finish()));
  await settled(page);
  await expect(page.getByLabel('Starting weight (kg)')).toHaveValue('82.5');
  await expect(page.locator('[data-step-heading]')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.coach-stepper').evaluate(nav=>{
    (nav.querySelectorAll('button')[1] as HTMLButtonElement).click();
    (nav.querySelectorAll('button')[0] as HTMLButtonElement).click();
  });
  await settled(page);await expect(page.locator('.coach-step-stage')).toHaveCSS('opacity','1');
  await expect(page.locator('[data-step-heading]')).toHaveText('Body');
  await page.emulateMedia({reducedMotion:'reduce'});await step(page,'Goal');
  await page.getByRole('radio',{name:'Fat loss',exact:true}).focus();
  await page.keyboard.press('ArrowRight');await expect(page.getByRole('radio',{name:'Maintenance',exact:true})).toBeChecked();
  expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:/4\. Macros/}).evaluate(node=>(node as HTMLButtonElement).click());
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('[data-step-heading]')).toHaveText('Macros');
  await expect(page.locator('[data-step-heading]')).toBeFocused();
  await expect(page.locator('.coach-step-stage')).toHaveCSS('opacity','1');
});

test('real calculation waits, errors, retry and stale responses after back to edit',async({page})=>{
  test.setTimeout(90000);
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let calls=0;
  await page.route('**/api/coach/preview',async route=>{
    calls++;
    const response=await route.fetch();
    if(calls===1)await gate;
    await route.fulfill({response});
  });
  await page.getByRole('button',{name:'Check in',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Calculating targets'})).toBeVisible();
  await expect(page.locator('.coach-wait-arc')).toBeVisible();
  await expect(page.getByText('Taking longer than usual.')).toBeVisible({timeout:12000});
  await page.screenshot({path:'artifacts/coach-calculating.png',fullPage:true});
  await page.getByRole('button',{name:'Back to edit',exact:true}).click();
  await step(page,'Goal');await page.getByRole('radio',{name:'Fat loss',exact:true}).check();
  await step(page,'Macros');await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await expect(page.getByRole('button',{name:'Accept this plan',exact:true})).toBeEnabled();
  release();await settled(page);
  await expect(page.locator('.proposal-card .target-figures > div:first-child strong')).toContainText('2,050');
  await expect(page.getByRole('button',{name:'Accept this plan',exact:true})).toBeEnabled();
  for(const theme of ['light','dark'])for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    await page.screenshot({path:`artifacts/coach-${theme}-${width}-review.png`,fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
  await page.unroute('**/api/coach/preview');
  await page.route('**/api/coach/preview',route=>route.fulfill({status:503,json:{message:'Preview temporarily unavailable.'}}));
  await page.getByRole('button',{name:'Back to edit',exact:true}).click();
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Preview temporarily unavailable.');
  await expect(page.locator('.coach-wait-arc')).toHaveCount(0);
  await page.unroute('**/api/coach/preview');
  await page.getByRole('button',{name:'Retry calculation',exact:true}).click();
  await expect(page.getByRole('button',{name:'Accept this plan',exact:true})).toBeEnabled();
});

test('lost acceptance response replays the exact identity and revision',async({page})=>{
  await changeGoal(page);await expect(page.getByRole('button',{name:'Accept this plan',exact:true})).toBeEnabled();
  const requests:unknown[]=[];
  await page.route('**/api/coach/accept',async route=>{
    requests.push(route.request().postDataJSON());
    if(requests.length===1){await route.fetch();await route.abort('failed');}
    else await route.continue();
  });
  await page.getByRole('button',{name:'Accept this plan',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Activation could not be confirmed');
  await expect(page.getByRole('button',{name:'Back to edit',exact:true})).toBeDisabled();
  // Reconcile state between attempts: retry must still use the original input revision.
  const refreshed=page.waitForResponse('**/api/state');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await refreshed;
  await page.getByRole('button',{name:'Accept this plan',exact:true}).click();
  await expect(page.getByText('Plan active.',{exact:true})).toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
});

test('offline profile retention and acceptance refresh failure recover without duplicate acceptance',async({page,context})=>{
  await page.getByRole('button',{name:'Plan',exact:true}).click();await step(page,'Goal');
  await page.getByRole('radio',{name:'Fat loss',exact:true}).check();await step(page,'Macros');
  await context.setOffline(true);await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await expect(page.getByText('Profile retained on this device. Waiting for a connection.')).toBeVisible();
  await expect(page.locator('.coach-wait-arc')).toHaveCount(0);
  await context.setOffline(false);await expect(page.getByRole('button',{name:'Accept this plan',exact:true})).toBeEnabled({timeout:25000});
  let failRefresh=false,accepts=0;
  await page.route('**/api/coach/accept',async route=>{
    accepts++;const response=await route.fetch();failRefresh=true;await route.fulfill({response});
  });
  await page.route('**/api/state',route=>failRefresh?route.fulfill({status:503,json:{message:'Unavailable'}}):route.continue());
  await page.getByRole('button',{name:'Accept this plan',exact:true}).click();
  await expect(page.getByText('Plan active.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry loading targets',exact:true})).toBeVisible();
  failRefresh=false;await page.getByRole('button',{name:'Retry loading targets',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry loading targets',exact:true})).toHaveCount(0);
  expect(accepts).toBe(1);
});

test('weekly check-in card and dialog settle across themes and responsive widths',async({page,context})=>{
  const state=await (await context.request.get('/api/state')).json();
  const edit=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,data:state.profile}});
  expect(edit.ok(),await edit.text()).toBeTruthy();
  await page.reload();await page.getByRole('button',{name:'Coach',exact:true}).click();
  await expect(page.getByRole('button',{name:'Review this week',exact:true})).toBeVisible();
  for(const theme of ['light','dark'])for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await settled(page);
    await page.screenshot({path:`artifacts/check-in-${theme}-${width}-card.png`,fullPage:true});
    const launcher=page.getByRole('button',{name:'Review this week',exact:true});await launcher.click();
    const dialog=page.getByRole('dialog',{name:'Weekly check-in'});await expect(dialog).toBeVisible();await settled(page);
    await page.screenshot({path:`artifacts/check-in-${theme}-${width}-dialog.png`,fullPage:true});
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(launcher).toBeFocused();
  }
});

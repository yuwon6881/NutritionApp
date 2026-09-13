import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
const password='nutrition test password 2026';
const headers={'Origin':(process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088'),'X-Nutrition-Request':'1'};
async function signIn(request:APIRequestContext,username='test-alice'){
  let response=await request.post('/api/auth/login',{headers,data:{username,password}});
  for(let attempt=0;response.status()===429&&attempt<12;attempt++){await new Promise(resolve=>setTimeout(resolve,5000));response=await request.post('/api/auth/login',{headers,data:{username,password}});}
  if(response.status()===401)response=await request.post('/api/auth/register',{headers,data:{username,password}});
  expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}
async function resolveMissingDays(page:import('@playwright/test').Page){
  await page.getByRole('dialog',{name:/^No food logged for /}).getByRole('button',{name:'Not logging',exact:true}).click({timeout:5000}).catch(()=>{});
}
test.describe.configure({mode:'serial'});
test.beforeAll(async({request})=>{
  await request.post('/api/auth/dev-reset',{headers});
});
test('private app: create profile, accept targets, log food and weight, retain offline work',async({page,context})=>{
  await page.setViewportSize({width:390,height:900});
  await page.goto('/');await page.getByRole('button',{name:'New here? Create an account'}).click();
  await page.getByLabel('Username',{exact:true}).fill('test-alice');await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('heading',{name:"Set up profile"})).toBeVisible();
  await expect(page.getByLabel('Date of birth',{exact:true})).toHaveValue('');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.screenshot({path:'artifacts/390-Onboarding.png',fullPage:true});
  await page.reload();await expect(page.getByRole('heading',{name:"Set up profile"})).toBeVisible();
  const user=await (await context.request.get('/api/state')).json();
  await page.getByLabel('Date of birth',{exact:true}).fill('1996-03-14');await page.getByLabel('Height (cm)').fill('170');
  await page.getByLabel('Starting weight (kg)').fill('81');
  await page.getByLabel('Sex parameter for equation',{exact:true}).selectOption('female');
  await page.getByRole('button',{name:/^Next: Activity/}).click();
  await page.getByLabel('Usual activity (approximate)',{exact:true}).selectOption('1.4');
  await page.getByLabel('Known maintenance calories (optional)').fill('2500');
  await page.getByRole('button',{name:/^Next: Goal/}).click();
  await page.getByRole('radio',{name:'Fat loss',exact:true}).check();
  await page.getByRole('slider',{name:'Rate (% bodyweight per week)'}).press('End');
  await page.getByRole('radio',{name:'Maintenance',exact:true}).check();
  await page.getByLabel('Track my goal by',{exact:true}).selectOption('duration');await page.getByLabel('Phase length (weeks)').fill('4');
  await page.getByRole('button',{name:/^Next: Macros/}).click();
  await page.getByRole('button',{name:'Keto',exact:true}).click();
  await page.getByRole('button',{name:'Coach default',exact:true}).click();
  await page.getByRole('button',{name:/^Next: Adjust/}).click();
  await page.getByRole('button',{name:/^Next: Distribution/}).click();
  await page.getByRole('button',{name:/^Next: Review/}).click();
  await page.getByRole('button',{name:'Create my starting estimate',exact:true}).click();
  await expect(page.getByRole('button',{name:'Accept this plan'})).toBeEnabled();await page.getByRole('button',{name:'Accept this plan'}).click();
  await expect(page.getByText('Plan active.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();await page.getByRole('button',{name:'Manual entry'}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Nasi lemak reviewed portion');await page.getByLabel('Calories (kcal)',{exact:true}).fill('520');
  await page.getByLabel('Protein (g)',{exact:true}).fill('18');await page.getByRole('button',{name:'Add to batch',exact:true}).click();await page.getByRole('button',{name:'Log all 1 food',exact:true}).click();await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Nasi lemak reviewed portion',exact:true}).first()).toBeVisible();
  await expect.poll(async()=>{const s=await context.request.get('/api/state');return (await s.json()).entries.some((e:{name:string})=>e.name==='Nasi lemak reviewed portion');}).toBeTruthy();
  await expect(page.getByText('Still logging',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Progress',exact:true}).click();await expect(page.locator('[data-page-heading]')).toHaveText('Progress');await page.waitForTimeout(400);await page.getByRole('button',{name:'Add weigh-in',exact:true}).click();await page.getByLabel('Weight (kg)',{exact:true}).fill('80.8');await page.getByRole('button',{name:/Save weigh-in|Update weigh-in/}).click();
  await expect(page.getByText('80.8 kg',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Daily weight',exact:true}).click();await expect(page.getByRole('img',{name:/Daily scale weight chart/})).toBeVisible();
  await page.getByRole('button',{name:'Trend weight',exact:true}).click();await expect(page.getByRole('img',{name:/Trend weight chart/})).toBeVisible();
  await page.getByRole('button',{name:'Energy',exact:true}).click();
  const energyPeriod=page.getByLabel('Energy history period',{exact:true});
  await expect(energyPeriod.locator('option')).toHaveText(['Last week','Last month','Last 6 months','One year','All']);
  await energyPeriod.selectOption('week');await expect(page.getByRole('img',{name:/grouped daily/})).toBeVisible();
  await energyPeriod.selectOption('six-months');await expect(page.getByRole('img',{name:/grouped weekly/})).toBeVisible();
  await energyPeriod.selectOption('year');await expect(page.getByRole('img',{name:/grouped monthly/})).toBeVisible();
  await page.getByRole('button',{name:'Weight',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sync',exact:true})).toHaveCount(0);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBeTruthy();
  await context.setOffline(true);await page.getByRole('button',{name:'Add entry',exact:true}).first().click();await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();await page.getByRole('button',{name:'Manual entry'}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Offline banana');await page.getByLabel('Calories (kcal)',{exact:true}).fill('105');await page.getByRole('button',{name:'Add to batch',exact:true}).click();await page.getByRole('button',{name:'Log all 1 food',exact:true}).click();await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('button',{name:'Offline banana',exact:true})).toBeVisible();await expect(page.getByText('Pending sync',{exact:true}).first()).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'Food Log',exact:true}).click();await expect(page.getByRole('button',{name:'Offline banana',exact:true})).toBeVisible();
  await context.setOffline(false);
  await expect.poll(async()=>{const s=await context.request.get('/api/state');return (await s.json()).entries.some((e:{name:string})=>e.name==='Offline banana');}).toBeTruthy();
  const secondContext=await context.browser()!.newContext({baseURL:(process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088')});const second=secondContext.request;await signIn(second,'test-bob');
  const other=await (await second.get('/api/state')).json();expect(other.entries).toHaveLength(0);expect(other.id).not.toBe(user.id);
  const third=await second.post('/api/auth/register',{headers,data:{username:'third-user',password}});expect(third.status()).toBe(409);
  const csrf=await context.request.post('/api/sync',{data:{}});expect(csrf.status()).toBe(403);
  await secondContext.close();
});
test('Body records save, review, edit, and clear measurement values',async({page,context})=>{
  await signIn(context.request);await page.goto('/');await page.getByRole('button',{name:'Progress',exact:true}).click();await page.getByRole('button',{name:'Body',exact:true}).click();
  await page.getByRole('button',{name:'Add body record',exact:true}).click();
  await page.getByLabel('Waist (cm)',{exact:true}).fill('82');await page.getByLabel('Body fat (%)',{exact:true}).fill('21');
  await page.getByRole('button',{name:'Save Body record',exact:true}).click();
  await page.getByRole('button',{name:'Open history',exact:true}).click();await expect(page.getByRole('heading',{name:'Body history',exact:true})).toBeVisible();
  // The save is queued independently of closing the editor; reopen history after the retained write settles.
  await expect.poll(async()=>{const response=await context.request.get('/api/body-records');return (await response.json()).records.length;}).toBe(1);
  if(await page.getByRole('button',{name:/2 measurements/}).count()===0){await page.getByRole('button',{name:'Back to Body',exact:true}).click();await page.getByRole('button',{name:'Open history',exact:true}).click();}
  const historyRow=page.getByRole('button',{name:/2 measurements/}).first();await expect(historyRow).toBeVisible();await historyRow.click();
  await expect(page.getByRole('heading',{name:'Body record',exact:true})).toBeVisible();await expect(page.getByText('82',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to Body history',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Waist (cm)',{exact:true}).fill('');await page.getByRole('button',{name:'Save Body record',exact:true}).click();
  await expect(page.getByRole('button',{name:/1 measurement/})).toBeVisible();
});
test('responsive screens have no horizontal overflow and working touch targets',async({page,context})=>{
  await signIn(context.request);await page.goto('/');await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();
  test.setTimeout(120000);
  for(const theme of ['light','dark'])for(const width of [390,768,1440]){
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('nourish-theme',theme);},theme);
    await page.setViewportSize({width,height:900});
    const items=['Dashboard','Progress','Coach','Settings'];
    for(const name of items){
      await page.getByRole('button',{name,exact:true}).first().click();
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
      // Shared selection rows must not wrap or give short labels shorter buttons.
      for(const control of await page.locator('.segmented-control:visible').all()){
        const buttons=control.getByRole('button');
        await expect(buttons.first()).toBeVisible();
        const boxes=await buttons.evaluateAll(elements=>elements.map(element=>{
          const rect=element.getBoundingClientRect();return {top:rect.top,height:rect.height,width:rect.width};
        }));
        expect(Math.max(...boxes.map(box=>box.top))-Math.min(...boxes.map(box=>box.top))).toBeLessThanOrEqual(1);
        expect(Math.max(...boxes.map(box=>box.height))-Math.min(...boxes.map(box=>box.height))).toBeLessThanOrEqual(1);
        expect(Math.min(...boxes.map(box=>box.height))).toBeGreaterThanOrEqual(44);
        if(await control.getAttribute('data-layout')==='equal')expect(Math.max(...boxes.map(box=>box.width))-Math.min(...boxes.map(box=>box.width))).toBeLessThanOrEqual(1);
      }
      if(width<1024){const small=await page.locator('button:visible').evaluateAll(buttons=>buttons.filter(b=>b.getBoundingClientRect().height<43).map(b=>b.textContent));expect(small).toEqual([]);}
      if(name==='Settings'){
        await expect(page.getByRole('heading',{name:'Storage',exact:true})).toHaveCount(0);
        await expect(page.getByRole('heading',{name:'Local data on this device',exact:true})).toHaveCount(0);
      }
      if(name==='Progress'){
        const historyField=page.locator('.select-field').filter({hasText:'Weight history period'}).first();
        await historyField.locator('.custom-select-trigger').click();
        const menu=historyField.locator('.custom-select-menu');
        await expect(menu).toBeVisible();
        await expect.poll(()=>menu.evaluate(element=>getComputedStyle(element).scrollbarColor)).not.toBe('auto');
        await page.keyboard.press('Escape');
      }
      await page.screenshot({path:`artifacts/${theme}-${width}-${name.replace(' ','-')}.png`,fullPage:true});
    }
    if(width<1024){
      await page.getByRole('button',{name:/Add/}).first().click();
      await expect(page.getByRole('dialog',{name:'Add'})).toBeVisible();
      await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();
      await expect(page.getByRole('dialog',{name:'Log food'})).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog',{name:'Log food'})).not.toBeVisible();
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
      await page.screenshot({path:`artifacts/${theme}-${width}-Log-food.png`,fullPage:true});
    }
  }
});
test('add dialog is adaptive, reduced-motion safe, and restores launcher focus',async({page,context})=>{
  await signIn(context.request);await page.goto('/');await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();
  const launcher=page.getByRole('button',{name:'Add entry'});
  for(const width of [390,768]){
    await page.setViewportSize({width,height:900});await launcher.click();
    const dialog=page.getByRole('dialog',{name:'Add'});await expect(dialog).toBeVisible();
    const box=await dialog.boundingBox();expect(box).not.toBeNull();
    if(width<640)expect(Math.abs((box!.y+box!.height)-900)).toBeLessThanOrEqual(2);
    else expect(Math.abs((box!.y+box!.height/2)-450)).toBeLessThanOrEqual(2);
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(launcher).toBeFocused();
  }
  await page.emulateMedia({reducedMotion:'reduce'});await launcher.click();
  await expect(page.getByRole('dialog',{name:'Add'})).toHaveCSS('transition-duration','0s');
  await page.keyboard.press('Escape');await expect(launcher).toBeFocused();
});
test('explicit light and dark themes persist without following the browser',async({page,context})=>{
  await signIn(context.request);await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).first().click();
  const appearance=page.getByLabel('Appearance',{exact:true});await expect(appearance.locator('option')).toHaveText(['Light','Dark']);
  await appearance.selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content','#0b0e14');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();await page.getByLabel('Appearance',{exact:true}).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content','#fcfcfc');
});
test('changed food dialog asks before closing while AI input stays transient',async({page,context})=>{
  await signIn(context.request);await page.goto('/');const launcher=page.getByRole('button',{name:'Add entry'}).first();await launcher.click();
  await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();await page.getByRole('button',{name:'Manual entry'}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Keep this draft');await page.getByRole('button',{name:'Close dialog'}).click();
  await expect(page.getByText('Discard changes?',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Keep editing'}).click();await expect(page.getByLabel('Food name',{exact:true})).toHaveValue('Keep this draft');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Discard changes'}).click();await expect(page.getByRole('dialog',{name:'Log food'})).toBeVisible();await expect(page.getByLabel('Food name',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'AI logging',exact:true}).click();await page.getByLabel('Meal description and portions').fill('Backdrop draft');
  const foodDialog=page.getByRole('dialog',{name:'Log food'});const box=await foodDialog.boundingBox();expect(box).not.toBeNull();await page.mouse.click(Math.max(1,box!.x-8),box!.y+8);
  await expect(page.getByText('Discard changes?',{exact:true})).toHaveCount(0);await expect(foodDialog).not.toBeVisible();await expect(launcher).toBeFocused();
  await launcher.click();await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();await page.getByRole('button',{name:'AI logging',exact:true}).click();
  await expect(page.getByRole('button',{name:'Resume estimate',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Meal description and portions')).toHaveValue('');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(launcher).toBeFocused();
});
test('API idempotency, revisions, expiry-safe drafts and asset MIME protection',async({request})=>{
  await signIn(request);const state=await (await request.get('/api/state')).json();
  const mutation={id:randomUUID(),recordId:randomUUID(),kind:'entry',expectedRevision:0,delete:false,data:{date:state.end,name:'Replay check',calories:25,quantity:1,unit:'serving'}};
  const one=await request.post('/api/sync',{headers,data:mutation});expect(one.ok()).toBeTruthy();
  const replay=await request.post('/api/sync',{headers,data:mutation});expect(await replay.json()).toEqual(await one.json());
  const changed=await request.post('/api/sync',{headers,data:{...mutation,data:{...mutation.data,calories:50}}});expect(changed.status()).toBe(409);
  const stale=await request.post('/api/sync',{headers,data:{...mutation,id:randomUUID()}});expect(stale.status()).toBe(409);
  const current=await (await request.get('/api/state')).json();expect(current.id).toBe(state.id);
  const missing=await request.get('/assets/does-not-exist.js');expect(missing.status()).toBe(404);expect(missing.headers()['content-type']??'').not.toContain('text/html');
  const scan=await request.post('/api/scans',{headers,data:{id:randomUUID(),mode:'description',description:'One banana',imageBase64:null}});expect(scan.ok()).toBeTruthy();
  const job=await scan.json();const processed=await request.post(`/api/scans/${job.id}/process`,{headers,data:{}});expect((await processed.json()).status).toBe('failed');
});

test('physique photo draft survives offline reopening without cloud credentials',async({page,context})=>{
  await signIn(context.request);await page.goto('/');
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await page.getByRole('button',{name:'Body',exact:true}).click();
  await page.getByRole('button',{name:'Add photo set',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Front',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Side',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Back',exact:true})).toBeVisible();
  await page.getByLabel('Front photo',{exact:true}).setInputFiles('public/icon-512.png');
  await expect(page.getByAltText('Selected front physique photo')).toBeVisible();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await context.setOffline(true);
  await page.getByRole('button',{name:'Save photo set and upload',exact:true}).click();
  await expect(page.getByRole('button',{name:'Discard local photo set',exact:true})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'Progress',exact:true}).click();
  await page.getByRole('button',{name:'Body',exact:true}).click();
  await expect(page.getByRole('button',{name:'Discard local photo set',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Discard local photo set',exact:true}).click();
  await expect(page.getByRole('button',{name:'Discard local photo set',exact:true})).toHaveCount(0);
});

test('photo gallery paginates complete sets and keeps missing angles explicit',async({page,context})=>{
  await signIn(context.request);
  const newestSet=randomUUID(),oldestSet=randomUUID();
  const newestFront=randomUUID(),newestBack=randomUUID(),oldestFront=randomUUID(),oldestSide=randomUUID();
  const photo=(id:string,setId:string,date:string,angle:'front'|'side'|'back')=>({id,setId,date,angle,bytes:128,status:'complete'});
  const first={configured:true,usedBytes:512,maxBytes:268435456,sets:[{id:newestSet,date:'2026-09-12',photos:[photo(newestFront,newestSet,'2026-09-12','front'),photo(newestBack,newestSet,'2026-09-12','back')]}],nextCursor:'older-cursor',hasMore:true};
  const second={configured:true,usedBytes:512,maxBytes:268435456,sets:[{id:oldestSet,date:'2026-09-01',photos:[photo(oldestFront,oldestSet,'2026-09-01','front'),photo(oldestSide,oldestSet,'2026-09-01','side')]}],nextCursor:null,hasMore:false};
  await page.route('**/api/photos**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/photos'&&route.request().method()==='GET')return route.fulfill({contentType:'application/json',body:JSON.stringify(url.searchParams.has('cursor')?second:first)});
    if(url.pathname.endsWith('/delete')&&route.request().method()==='POST')return route.fulfill({status:204});
    if(url.pathname.endsWith('/content')&&route.request().method()==='GET')return route.fulfill({contentType:'image/jpeg',body:Buffer.from([0xff,0xd8,0xff,0xd9])});
    return route.continue();
  });
  await page.goto('/');await page.getByRole('button',{name:'Progress',exact:true}).click();await page.getByRole('button',{name:'Body',exact:true}).click();
  await page.getByRole('button',{name:'Open gallery',exact:true}).click();await expect(page.getByRole('heading',{name:'Gallery',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'2026-09-12',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Load more',exact:true})).toBeVisible();
  await expect(page.getByText('Side · Not uploaded',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Load more',exact:true}).click();await expect(page.getByRole('heading',{name:'2026-09-01',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Compare',exact:true}).click();await expect(page.getByRole('heading',{name:'Compare photos',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'2026-09-12',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Side',exact:true}).click();await expect(page.getByText('Not uploaded',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Older set',exact:true}).click();
  await expect(page.getByRole('heading',{name:'2026-09-01',exact:true})).toBeVisible();await expect(page.getByRole('img',{name:'Side physique photo from 2026-09-01'})).toBeVisible();await page.getByRole('button',{name:'Back to Gallery',exact:true}).click();
  await page.getByRole('button',{name:'Edit',exact:true}).first().click();await expect(page.getByRole('dialog',{name:'Edit physique photo set'})).toBeVisible();await page.getByRole('button',{name:'Delete',exact:true}).first().click();
  const deleteDialog=page.getByRole('dialog',{name:'Delete front photo?'});await expect(deleteDialog).toBeVisible();await deleteDialog.getByRole('button',{name:'Keep view',exact:true}).click();await expect(deleteDialog).not.toBeVisible();
  await page.getByRole('button',{name:'Delete',exact:true}).first().click();await page.getByRole('dialog',{name:'Delete front photo?'}).getByRole('button',{name:'Delete view',exact:true}).click();await expect(page.getByRole('dialog',{name:/Delete .*photo\?/})).not.toBeVisible();await page.getByRole('dialog',{name:'Edit physique photo set'}).getByRole('button',{name:'Close dialog',exact:true}).click();
});

test('weekly check-in is a reduced-motion-safe bottom sheet with focus restoration',async({page,context})=>{
  await signIn(context.request);const state=await (await context.request.get('/api/state')).json();
  expect(state.profile).not.toBeNull();
  const profileResponse=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,data:state.profile}});
  expect(profileResponse.ok(),await profileResponse.text()).toBeTruthy();
  await page.setViewportSize({width:390,height:900});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  const launcher=page.getByRole('button',{name:'Review this week',exact:true});await expect(launcher).toBeVisible();
  await page.getByRole('button',{name:'Coach',exact:true}).click();await expect(page.getByRole('button',{name:'Review this week',exact:true})).toBeVisible();
  await launcher.click();
  const dialog=page.getByRole('dialog',{name:'Weekly check-in'});await expect(dialog).toBeVisible();
  const box=await dialog.boundingBox();expect(box).not.toBeNull();expect(Math.abs((box!.y+box!.height)-900)).toBeLessThanOrEqual(2);
  await expect(dialog).toHaveCSS('transition-duration','0s');await expect(dialog.getByRole('button',{name:'Accept',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Decline',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(launcher).toBeFocused();
});

test('phase pace and target-weight goals preserve learned maintenance',async({page,context})=>{
  await signIn(context.request);await page.goto('/');await page.getByRole('button',{name:'Coach',exact:true}).click();
  await page.getByRole('button',{name:'Plan',exact:true}).click();
  await page.getByRole('button',{name:/^Next: Activity/}).click();
  await page.getByRole('button',{name:/^Next: Goal/}).click();
  await page.getByRole('radio',{name:'Fat loss',exact:true}).check();await page.getByRole('slider',{name:'Rate (% bodyweight per week)'}).press('End');
  for(let i=0;i<5;i++)await page.getByRole('slider',{name:'Rate (% bodyweight per week)'}).press('ArrowLeft');
  await page.getByLabel('Track my goal by',{exact:true}).selectOption('weight');await page.getByLabel('Phase starting weight (kg)').fill('80.8');await page.getByLabel('Target weight (kg)').fill('75');
  await page.getByRole('button',{name:/^Next: Macros/}).click();
  await page.getByRole('button',{name:'High protein',exact:true}).click();
  await page.getByRole('button',{name:/^Next: Adjust/}).click();
  await page.getByRole('button',{name:/^Next: Distribution/}).click();
  await page.getByRole('button',{name:/^Next: Review/}).click();
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await expect(page.getByRole('button',{name:'Accept this plan'})).toBeEnabled({timeout:25000});
  expect(await page.getByRole('button',{name:'Accept this plan'}).count()).toBe(1);
  await page.getByRole('button',{name:'Accept this plan'}).click();
  await expect(page.getByText('Plan active.',{exact:true})).toBeVisible();
  expect((await (await context.request.get('/api/state')).json()).plans).toHaveLength(2);
  const state=await (await context.request.get('/api/state')).json();const result=JSON.parse(state.plans[0].resultJson);
  expect(result.expenditure).toBe(2500);expect(result.calories).toBe(2200);expect(state.profile.goalRatePercent).toBe(-0.35);
  await page.getByRole('button',{name:'Progress',exact:true}).click();await page.getByRole('button',{name:'Energy',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Energy balance',exact:true})).toBeVisible();
  await expect(page.getByText('No complete days with an accepted maintenance estimate.',{exact:true})).toBeVisible();

  const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
  let latest=await (await context.request.get('/api/state')).json();
  const saveWeight=async(date:string,kg:number)=>{
    const existing=latest.weights.find((weight:{date:string;deleted:boolean})=>weight.date===date&&!weight.deleted);
    const response=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:existing?.id??randomUUID(),kind:'weight',expectedRevision:existing?.revision??0,data:{date,kg}}});
    expect(response.ok(),await response.text()).toBeTruthy();
    latest=await (await context.request.get('/api/state')).json();
  };
  const markNotLogging=async(date:string)=>{
    const existing=latest.days.find((day:{date:string;deleted:boolean})=>day.date===date&&!day.deleted);
    const response=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:existing?.id??randomUUID(),kind:'day',expectedRevision:existing?.revision??0,data:{date,status:'not_logged'}}});
    expect(response.ok(),await response.text()).toBeTruthy();
    latest=await (await context.request.get('/api/state')).json();
  };
  await saveWeight(shift(latest.end,-3),80.8);await saveWeight(shift(latest.end,-2),80.8);await saveWeight(latest.end,74.8);
  await markNotLogging(shift(latest.end,-3));await markNotLogging(shift(latest.end,-2));
  await page.reload();await resolveMissingDays(page);await page.getByRole('button',{name:'Coach',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Fat loss goal reached',exact:true})).toBeVisible();
  await expect(page.locator('.goal-progress-path').first()).toContainText('Progressed from');
  await page.getByRole('button',{name:'History',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Goal progress',exact:true})).toBeVisible();
  await expect(page.locator('.goal-history-panel .goal-progress-path')).toContainText('Progressed from');
  await page.getByRole('button',{name:'Targets',exact:true}).click();
  await expect(page.getByRole('button',{name:'Complete goal',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Wait for trend weight',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Wait for trend weight',exact:true}).click();
  await expect(page.getByText('Waiting for trend weight',{exact:false})).toBeVisible();
  latest=await (await context.request.get('/api/state')).json();
  await saveWeight(shift(latest.end,-3),74.8);await saveWeight(shift(latest.end,-2),74.8);await saveWeight(latest.end,74.8);
  await page.reload();await resolveMissingDays(page);await page.getByRole('button',{name:'Coach',exact:true}).click();
  await expect(page.getByRole('button',{name:'Complete goal',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Wait for trend weight',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Complete goal',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Weekly check-in'})).toBeVisible({timeout:25000});
  await expect(page.getByRole('dialog',{name:'Weekly check-in'}).locator('[data-check-in-calorie]')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('accepted daily targets and offline cadence edits stay explicit',async({page,context})=>{
  await signIn(context.request);
  let state=await (await context.request.get('/api/state')).json();
  if(!state.profile||!state.plans.length){
    const profile={dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',goalRatePercent:0,distributionShares:[10,10,10,10,10,25,25],energyAdjustmentPercent:0};
    const saved=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,data:profile}});expect(saved.ok(),await saved.text()).toBeTruthy();
    const preview=await (await context.request.get('/api/coach/preview')).json();const accepted=await context.request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}});expect(accepted.ok(),await accepted.text()).toBeTruthy();
    state=await (await context.request.get('/api/state')).json();
  }
  const active=state.plans[0];const activeResult=JSON.parse(active.resultJson) as {calories:number;weeklyCalories?:number;dailyCalories?:number[]};
  const mondayIndex=(date:string)=>{const day=new Date(`${date}T00:00:00Z`).getUTCDay();return (day+6)%7;};
  const activeDaily=activeResult.dailyCalories?.[mondayIndex(state.end)]??activeResult.calories;
  const edited={...state.profile,goal:'lose',goalRatePercent:-0.5,energyAdjustmentPercent:15,distributionShares:[10,10,10,10,10,25,25],phaseMode:'open',phaseStart:null,durationWeeks:null,targetWeightKg:null,phaseStartWeightKg:null};
  const profileResponse=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,data:edited}});expect(profileResponse.ok(),await profileResponse.text()).toBeTruthy();
  const changed=await (await context.request.get('/api/state')).json();expect(changed.plans[0].id).toBe(active.id);
  const proposal=await (await context.request.get('/api/coach/preview')).json();expect(proposal.canAccept).toBeTruthy();expect(proposal.result.dailyCalories).toHaveLength(7);expect(proposal.result.dailyCalories.reduce((sum:number,value:number)=>sum+value,0)).toBe(proposal.result.weeklyCalories);
  await page.goto('/');
  const target=page.locator('.energy-panel p').filter({hasText:'kcal target'});await expect(target).toBeVisible();expect((await target.textContent())!.replaceAll(',','')).toContain(String(activeDaily));
  await resolveMissingDays(page);
  await page.getByRole('button',{name:'Progress',exact:true}).click();await page.getByRole('button',{name:'Energy',exact:true}).click();await expect(page.getByRole('heading',{name:'Continuous coaching guidance',exact:true})).toBeVisible();
  const acceptedResponse=await context.request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:proposal.revision}});expect(acceptedResponse.ok(),await acceptedResponse.text()).toBeTruthy();
  state=await (await context.request.get('/api/state')).json();const nextResult=JSON.parse(state.plans[0].resultJson) as {calories:number;weeklyCalories:number;dailyCalories:number[]};expect(state.plans[0].id).not.toBe(active.id);expect(nextResult.dailyCalories).toEqual(proposal.result.dailyCalories);expect(nextResult.dailyCalories.reduce((sum,value)=>sum+value,0)).toBe(nextResult.weeklyCalories);
  await page.reload();await resolveMissingDays(page);await page.getByRole('button',{name:'Settings',exact:true}).click();await context.setOffline(true);
  await page.locator('#settings-weight-unit').selectOption('lb');await expect(page.getByText(/Saving your unit preferences/)).toBeVisible();
  await page.locator('#settings-energy-unit').selectOption('kj');await page.locator('#settings-height-unit').selectOption('ft-in');await expect(page.getByText(/Saving your unit preferences/)).toBeVisible();
  await page.locator('#coaching-check-in-weekday').selectOption('5');await expect(page.getByText(/Saving your check-in day and unit preferences/)).toBeVisible();
  await page.reload();await resolveMissingDays(page);await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.locator('#coaching-check-in-weekday')).toHaveValue('5');await expect(page.locator('#settings-weight-unit')).toHaveValue('lb');await expect(page.locator('#settings-energy-unit')).toHaveValue('kj');await expect(page.locator('#settings-height-unit')).toHaveValue('ft-in');await expect(page.getByText(/Saving your check-in day and unit preferences/)).toBeVisible();
  await context.setOffline(false);await expect.poll(async()=>{const latest=await (await context.request.get('/api/state')).json();return latest.settings?.checkInWeekday===5&&latest.settings?.weightUnit==='lb'&&latest.settings?.energyUnit==='kj'&&latest.settings?.heightUnit==='ft-in';}).toBeTruthy();
  const afterSettings=await (await context.request.get('/api/state')).json();expect(afterSettings.profileRevision).toBe(state.profileRevision);expect(afterSettings.plans[0].id).toBe(state.plans[0].id);
  await page.locator('#coaching-check-in-weekday').selectOption('1');await expect.poll(async()=>{const latest=await (await context.request.get('/api/state')).json();return latest.settings?.checkInWeekday;}).toBe(1);
  await page.getByRole('button',{name:'Coach',exact:true}).click();await expect(page.getByText('kJ',{exact:true}).first()).toBeVisible();await expect(page.getByText(/lb/).first()).toBeVisible();await page.getByRole('button',{name:'Plan',exact:true}).click();await expect(page.getByLabel('Height (feet)',{exact:true})).toBeVisible();await expect(page.getByLabel('Starting weight (lb)',{exact:true})).toHaveValue('178.6');
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('#settings-weight-unit').selectOption('kg');await page.locator('#settings-energy-unit').selectOption('kcal');await page.locator('#settings-height-unit').selectOption('cm');await expect.poll(async()=>{const latest=await (await context.request.get('/api/state')).json();return latest.settings?.weightUnit==='kg'&&latest.settings?.energyUnit==='kcal'&&latest.settings?.heightUnit==='cm';}).toBeTruthy();
});

test('conflicting retained edits explain the saved record and can be discarded',async({page,context})=>{
  await signIn(context.request);
  let state=await (await context.request.get('/api/state')).json();
  const date=new Date(`${state.end}T00:00:00Z`);date.setUTCDate(date.getUTCDate()-1);const previousDate=date.toISOString().slice(0,10);
  const existing=state.days.find((day:{date:string;deleted:boolean})=>day.date===previousDate&&!day.deleted);
  const seeded=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:existing?.id??randomUUID(),kind:'day',expectedRevision:existing?.revision??0,data:{date:previousDate,status:'not_logged'}}});expect(seeded.ok(),await seeded.text()).toBeTruthy();
  state=await (await context.request.get('/api/state')).json();const day=state.days.find((item:{date:string;deleted:boolean})=>item.date===previousDate&&!item.deleted);expect(day).toBeTruthy();
  await page.goto('/');await resolveMissingDays(page);await page.getByRole('button',{name:'Food Log',exact:true}).click();await page.getByRole('button',{name:'Previous food day',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Close dialog',exact:true}).click({timeout:5000}).catch(()=>{});await expect(page.getByLabel('Logging status',{exact:true})).toHaveValue('not_logged');
  await context.setOffline(true);await page.getByLabel('Logging status',{exact:true}).selectOption('incomplete');await expect(page.getByRole('button',{name:'Discard local edit',exact:true})).toHaveCount(0);
  const changed=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:day.id,kind:'day',expectedRevision:day.revision,data:{date:previousDate,status:'complete'}}});expect(changed.ok(),await changed.text()).toBeTruthy();
  await context.setOffline(false);await expect(page.getByRole('heading',{name:'A saved edit needs review',exact:true})).toBeVisible();await expect(page.getByText(`Daily logging decision · ${previousDate}`,{exact:true})).toBeVisible();await expect(page.getByText('Queued choice',{exact:true})).toBeVisible();await expect(page.getByText('Still logging',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog',{name:/^No food logged for /})).toHaveCount(0);await page.getByRole('button',{name:'Discard local edit',exact:true}).click();await expect(page.getByRole('heading',{name:'A saved edit needs review',exact:true})).toHaveCount(0);
  const saved=await (await context.request.get('/api/state')).json();expect(saved.days.find((item:{date:string;deleted:boolean})=>item.date===previousDate&&!item.deleted).status).toBe('complete');
});



test('cached diary opens while the server sleeps and uploads retained food and weight on wake',async({page,context})=>{
  test.setTimeout(120000);
  await signIn(context.request);
  const initial=await (await context.request.get('/api/state')).json();
  if(!initial.profile)await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:initial.id,kind:'profile',expectedRevision:initial.profileRevision,data:{age:30,heightCm:175,weightKg:80,sex:'male',activity:1.4,goal:'maintain'}}});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  let release!:()=>void;const asleep=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/**',async route=>{
    if(route.request().url().endsWith('/auth/me'))await asleep;
    // The released handler can resume after unroute; a settled route is not a test failure.
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Server waking up'})}).catch(()=>{});
  });
  await page.reload();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible({timeout:3000});
  await resolveMissingDays(page);
  await page.getByRole('button',{name:'Add entry',exact:true}).click();await page.getByRole('dialog',{name:'Add',exact:true}).getByRole('button',{name:'Log food',exact:true}).click();
  await page.getByRole('button',{name:'Manual entry',exact:true}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Server wake meal');
  await page.getByLabel('Calories (kcal)',{exact:true}).fill('400');
  await page.getByRole('button',{name:'Add to batch',exact:true}).click();await page.getByRole('button',{name:'Log all 1 food',exact:true}).click();await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('button',{name:'Server wake meal',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add entry',exact:true}).click();await page.getByRole('dialog',{name:'Add',exact:true}).getByRole('button',{name:'Log weight',exact:true}).click();
  await page.getByLabel('Weight (kg)',{exact:true}).fill('80.6');
  await page.getByRole('button',{name:/Save weigh-in|Update weigh-in/}).click();
  release();await page.unroute('**/api/**');
  await expect.poll(async()=>{const state=await (await context.request.get('/api/state')).json();return state.entries.some((e:{name:string})=>e.name==='Server wake meal')&&state.weights.some((w:{kg:number})=>w.kg===80.6);},{timeout:45000}).toBeTruthy();
});

test('missed weight-only day asks once and keeps the weight after not logging',async({page,context})=>{
  await signIn(context.request);
  const latest=await (await context.request.get('/api/state')).json();
  const date=new Date(Date.parse(latest.end)-86400000).toISOString().slice(0,10);
  const existingDay=latest.days.find((day:{date:string;deleted:boolean})=>day.date===date&&!day.deleted);
  const seededDay=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:existingDay?.id??randomUUID(),kind:'day',expectedRevision:existingDay?.revision??0,data:{date,status:'incomplete'}}});
  expect(seededDay.ok(),await seededDay.text()).toBeTruthy();
  const seededWeight=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:randomUUID(),kind:'weight',expectedRevision:0,data:{date,kg:80.4}}});
  expect(seededWeight.ok(),await seededWeight.text()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('dialog',{name:`No food logged for ${date}`})).toBeVisible();
  await page.getByRole('button',{name:'Not logging',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect.poll(async()=>{const state=await (await context.request.get('/api/state')).json();return state.days.some((d:{date:string;status:string})=>d.date===date&&d.status==='not_logged')&&state.weights.some((w:{date:string})=>w.date===date);}).toBeTruthy();
  await page.reload();await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});


test('mobile scan shortcut supports food photos and label autofill before review',async({page,context})=>{
  test.setTimeout(120000);
  await signIn(context.request);
  const state=await (await context.request.get('/api/state')).json();
  if(!state.profile)await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,data:{age:30,heightCm:175,weightKg:80,sex:'male',activity:1.4,goal:'maintain'}}});
  await page.setViewportSize({width:390,height:900});await page.goto('/');
  await page.getByRole('button',{name:'Add entry',exact:true}).click();
  await page.getByRole('button',{name:'Scan food or label',exact:true}).click();
  await expect(page.getByRole('heading',{name:'AI logging',exact:true})).toBeVisible();
  const modes:string[]=[];
  await page.route('**/api/scans',async route=>{
    const input=route.request().postDataJSON();modes.push(input.mode);
    expect(input.imageBase64).toBeTruthy();
    await route.fulfill({contentType:'application/json',body:JSON.stringify({id:input.id,status:'complete',resultJson:JSON.stringify({foods:[{name:input.mode==='label'?'Label yoghurt':'Photo meal',quantity:100,unit:'g',calories:120,protein:6,carbs:15,fat:4,fiber:null,notes:'Per 100 g'}],questions:[],explanation:'Review the quantity and nutrients.'})})});
  });
  for(const mode of ['photo','label']){
  await page.getByLabel('How would you like to log?',{exact:true}).selectOption(mode);
    await expect(page.locator('.custom-file-dropzone')).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveAttribute('capture','environment');
    await page.locator('input[type="file"]').setInputFiles('public/icon-512.png');
    await page.getByRole('button',{name:mode==='label'?'Read nutrition label':'Estimate my meal',exact:true}).click();
    const foodName=mode==='label'?'Label yoghurt':'Photo meal';
    await expect(page.getByRole('heading',{name:'Batch (1 food)'})).toBeVisible();
    await page.getByRole('button',{name:'Actions for '+foodName}).click();
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    await expect(page.getByLabel('Calories (kcal)',{exact:true})).toHaveValue('120');
    await expect(page.getByLabel('Fiber (g)',{exact:true})).toHaveValue('');
    if(mode==='label')await page.getByLabel('Calories (kcal)',{exact:true}).fill('135');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    if(mode==='photo'){await page.getByRole('button',{name:'Remove '+foodName,exact:true}).click();await page.getByRole('button',{name:'Add more food'}).click();}
  }
  expect(modes).toEqual(['photo','label']);
  await page.getByRole('button',{name:'Log all 1 food',exact:true}).click();
  await expect.poll(async()=>{const state=await (await context.request.get('/api/state')).json();return state.entries.some((e:{name:string;calories:number;source:string})=>e.name==='Label yoghurt'&&e.calories===135&&e.source==='AI label estimate');}).toBeTruthy();
});


test('an open offline diary completes its logged day after local midnight',async({page,context})=>{
  test.setTimeout(120000);
  await signIn(context.request);await page.clock.install();await page.goto('/');await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByText('Still logging',{exact:true})).toBeVisible();
  await context.setOffline(true);
  await page.clock.fastForward(24*60*60*1000);
  await expect(page.getByText('Complete',{exact:true})).toBeVisible();
});

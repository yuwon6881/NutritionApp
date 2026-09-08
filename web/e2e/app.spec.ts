import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
const password='nutrition test password 2026';
const headers={'Origin':'http://127.0.0.1:5088','X-Nutrition-Request':'1'};
async function signIn(request:APIRequestContext,username='test-alice'){
  let response=await request.post('/api/auth/login',{headers,data:{username,password}});
  if(response.status()===401)response=await request.post('/api/auth/register',{headers,data:{username,password}});
  expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}
test.describe.configure({mode:'serial'});
test('private app: create profile, accept targets, log food and weight, retain offline work',async({page,context})=>{
  await page.setViewportSize({width:390,height:900});
  await page.goto('/');await page.getByRole('button',{name:'New here? Create an account'}).click();
  await page.getByLabel('Username',{exact:true}).fill('test-alice');await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('heading',{name:"Let's find your starting point"})).toBeVisible();
  await expect(page.getByLabel('Age (years)')).toHaveValue('');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.screenshot({path:'artifacts/390-Onboarding.png',fullPage:true});
  await page.reload();await expect(page.getByRole('heading',{name:"Let's find your starting point"})).toBeVisible();
  const user=await (await context.request.get('/api/state')).json();
  await page.getByLabel('Age (years)').fill('30');await page.getByLabel('Height (cm)').fill('170');
  await page.getByLabel('Starting weight (kg)').fill('81');
  await page.getByLabel('Sex parameter for equation').selectOption('female');
  await page.getByRole('button',{name:/^Next: Activity/}).click();
  await page.getByLabel('Usual activity (approximate)').selectOption('1.4');
  await page.getByRole('button',{name:/^Next: Goal/}).click();
  await page.getByLabel('Your goal').selectOption('lose');
  await page.getByRole('slider',{name:'Calorie deficit (%)'}).press('End');
  await expect(page.getByText('Not recommended as a starting pace',{exact:false})).toBeVisible();
  await page.getByLabel('Your goal').selectOption('maintain');
  await page.getByLabel('Track my goal by').selectOption('duration');await page.getByLabel('Phase length (weeks)').fill('4');
  await page.getByRole('button',{name:/^Next: Review/}).click();
  await page.getByLabel('Known maintenance calories (optional)').fill('2500');
  await page.getByRole('button',{name:'Create my starting estimate',exact:true}).click();
  await expect(page.getByRole('button',{name:'Accept this plan'})).toBeEnabled();await page.getByRole('button',{name:'Accept this plan'}).click();
  await expect(page.getByText('Your reviewed plan is now active.')).toBeVisible();
  await page.getByRole('button',{name:'Log food',exact:true}).first().click();await page.getByRole('button',{name:'Quick entry'}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Nasi lemak reviewed portion');await page.getByLabel('Calories (kcal)',{exact:true}).fill('520');
  await page.getByLabel('Protein (g)',{exact:true}).fill('18');await page.getByRole('button',{name:'Save reviewed food'}).click();
  await expect(page.getByRole('button',{name:'Nasi lemak reviewed portion',exact:true}).first()).toBeVisible();
  await expect.poll(async()=>{const s=await context.request.get('/api/state');return (await s.json()).entries.some((e:{name:string})=>e.name==='Nasi lemak reviewed portion');}).toBeTruthy();
  await page.getByRole('button',{name:'Complete',exact:true}).click();await expect(page.getByRole('heading',{name:'Day marked complete'})).toBeVisible();
  await page.getByRole('button',{name:'Progress',exact:true}).click();await page.getByLabel('Weight (kg)',{exact:true}).fill('80.8');await page.getByRole('button',{name:/Save weigh-in|Update weigh-in/}).click();
  await expect(page.getByText('80.8 kg',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Daily weight',exact:true}).click();await expect(page.getByRole('img',{name:/Daily scale weight chart/})).toBeVisible();
  await page.getByRole('button',{name:'Calculated trend',exact:true}).click();await expect(page.getByRole('img',{name:/Calculated trend weight chart/})).toBeVisible();
  await page.getByLabel('Group energy bars by').selectOption('week');await expect(page.getByRole('img',{name:/Signed energy balance by week/})).toBeVisible();
  await page.getByLabel('Group energy bars by').selectOption('month');await expect(page.getByRole('img',{name:/Signed energy balance by month/})).toBeVisible();
  await expect(page.getByRole('button',{name:'Sync',exact:true})).toBeEnabled();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBeTruthy();
  await context.setOffline(true);await page.getByRole('button',{name:'Log food',exact:true}).first().click();await page.getByRole('button',{name:'Quick entry'}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Offline banana');await page.getByLabel('Calories (kcal)',{exact:true}).fill('105');await page.getByRole('button',{name:'Save reviewed food'}).click();
  await expect(page.getByRole('button',{name:'Offline banana',exact:true})).toBeVisible();await expect(page.getByText('Pending sync',{exact:true}).first()).toBeVisible();
  await page.reload();await expect(page.getByRole('button',{name:'Offline banana',exact:true})).toBeVisible();
  await context.setOffline(false);await page.getByRole('button',{name:/pending|Sync/}).first().click();
  await expect.poll(async()=>{const s=await context.request.get('/api/state');return (await s.json()).entries.some((e:{name:string})=>e.name==='Offline banana');}).toBeTruthy();
  const secondContext=await context.browser()!.newContext({baseURL:'http://127.0.0.1:5088'});const second=secondContext.request;await signIn(second,'test-bob');
  const other=await (await second.get('/api/state')).json();expect(other.entries).toHaveLength(0);expect(other.id).not.toBe(user.id);
  const third=await second.post('/api/auth/register',{headers,data:{username:'third-user',password}});expect(third.status()).toBe(409);
  const csrf=await context.request.post('/api/sync',{data:{}});expect(csrf.status()).toBe(403);
  await secondContext.close();
});
test('responsive screens have no horizontal overflow and working touch targets',async({page,context})=>{
  await signIn(context.request);await page.goto('/');await expect(page.getByRole('heading',{name:'Your daily picture'})).toBeVisible();
  for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const name of ['Today','Log food','Progress','Coach','Settings']){
      await page.getByRole('button',{name,exact:true}).first().click();
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
      if(width<1024){const small=await page.locator('button:visible').evaluateAll(buttons=>buttons.filter(b=>b.getBoundingClientRect().height<43).map(b=>b.textContent));expect(small).toEqual([]);}
      await page.screenshot({path:`artifacts/${width}-${name.replace(' ','-')}.png`,fullPage:true});
    }
  }
});
test('API idempotency, revisions, expiry-safe drafts and asset MIME protection',async({request})=>{
  await signIn(request);const state=await (await request.get('/api/state')).json();
  const mutation={id:randomUUID(),recordId:randomUUID(),kind:'entry',expectedRevision:0,delete:false,data:{date:new Date().toISOString().slice(0,10),name:'Replay check',calories:25,quantity:1,unit:'serving',meal:'Snack'}};
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
  await page.getByLabel('Choose physique photo').setInputFiles('public/icon-512.png');
  await expect(page.getByAltText('Your selected physique photo')).toBeVisible();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await context.setOffline(true);
  await page.getByRole('button',{name:'Save photo draft and upload',exact:true}).click();
  await expect(page.getByRole('button',{name:'Discard local photo draft',exact:true})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'Progress',exact:true}).click();
  await expect(page.getByRole('button',{name:'Discard local photo draft',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Discard local photo draft',exact:true}).click();
  await expect(page.getByRole('button',{name:'Discard local photo draft',exact:true})).toHaveCount(0);
});

test('phase pace and target-weight goals preserve learned maintenance',async({page,context})=>{
  await signIn(context.request);await page.goto('/');await page.getByRole('button',{name:'Coach',exact:true}).click();
  await page.getByRole('button',{name:'Adjust profile & strategy'}).click();
  await page.getByRole('button',{name:/Goal & Pace|3\. Goal/}).click();
  await page.getByLabel('Your goal').selectOption('lose');await page.getByRole('slider',{name:'Calorie deficit (%)'}).press('End');
  for(let i=0;i<5;i++)await page.getByRole('slider',{name:'Calorie deficit (%)'}).press('ArrowLeft');
  await page.getByLabel('Track my goal by').selectOption('weight');await page.getByLabel('Phase starting weight (kg)').fill('80.8');await page.getByLabel('Target weight (kg)').fill('75');
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await page.getByRole('button',{name:'Weekly check-in'}).click();
  await expect(page.getByRole('button',{name:'Review my targets'})).toBeEnabled();await page.getByRole('button',{name:'Review my targets'}).click();
  await expect(page.getByRole('button',{name:'Accept this plan'})).toBeEnabled();await page.getByRole('button',{name:'Accept this plan'}).click();
  await expect(page.getByText('Your reviewed plan is now active.')).toBeVisible();
  const state=await (await context.request.get('/api/state')).json();const result=JSON.parse(state.plans[0].resultJson);
  expect(result.expenditure).toBe(2500);expect(result.calories).toBe(2000);expect(state.profile.energyAdjustmentPercent).toBe(20);
  await page.getByRole('button',{name:'Progress',exact:true}).click();await expect(page.getByRole('heading',{name:'Your weight goal',exact:true})).toBeVisible();
  await expect(page.getByText('Not yet estimable',{exact:true})).toBeVisible();
});


import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from './signIn';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;
const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const daysAgo=(offset:number)=>{const day=new Date(`${current}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-offset);return day.toISOString().slice(0,10);};
const iso=/\b20\d{2}-\d{2}-\d{2}\b/;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const response=await signInApi(request,'flat-shell');
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const save=async(kind:string,data:unknown,recordId=randomUUID())=>{
    const saved=await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId,expectedRevision:0,delete:false,data}});
    expect(saved.ok(),await saved.text()).toBeTruthy();
  };
  await save('profile',{dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0},state.id);
  const preview=await (await request.get('/api/coach/preview')).json();
  expect((await request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}})).ok()).toBeTruthy();
  for(let offset=8;offset>=0;offset--){
    await save('entry',{date:daysAgo(offset),name:'Rolled oats',calories:380,protein:13,carbs:66,fat:7,quantity:1,unit:'serving',time:'08:00'});
    await save('weight',{date:daysAgo(offset),kg:81-offset*.1});
  }
  session=await request.storageState();
});

async function noHorizontalOverflow(page:import('@playwright/test').Page){
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for(const [width,theme] of [[390,'light'],[390,'dark'],[768,'light'],[768,'dark'],[1440,'light'],[1440,'dark']] as const){
  test(`${theme} ${width}: shell, dates and flat grouping`,async({page,context})=>{
    await context.addCookies(session.cookies);
    await page.setViewportSize({width,height:900});
    await page.addInitScript(value=>localStorage.setItem('nutrition-theme',value),theme);
    await page.goto('/');
    await expect(page.locator('.account-name')).toHaveText('flat-shell');

    // The account lives in the side navigation from 640 px; phones show the brand in the top bar instead.
    if(width>=640){
      await expect(page.locator('.sidebar-account')).toBeVisible();
      await expect(page.locator('.topbar .topbar-ai')).toBeHidden();
      if(width>=1024)await expect(page.locator('.sidebar-account .account-name')).toBeVisible();
    }else{
      await expect(page.locator('.sidebar-account')).toBeHidden();
      await expect(page.locator('.topbar-brand')).toBeVisible();
    }
    await noHorizontalOverflow(page);

    // The Food Log date field spells the month; a numeric date reads as two different days.
    await page.locator('nav button:visible',{hasText:/^Food Log$/}).first().click();
    await expect(page.getByRole('heading',{name:'Food Log',level:1})).toBeVisible();
    const dateTrigger=page.getByRole('button',{name:'Choose food date'});
    await expect(dateTrigger).toContainText(/^[A-Z][a-z]{2} \d{1,2}, 20\d{2}/);
    await expect(dateTrigger).not.toContainText(/\d{2}\/\d{2}\/\d{4}/);
    // A slot's "+" hangs below its time label instead of overlapping it, with a mouse (shown on hover) or touch.
    const slotRow=page.locator('.food-time-row').first();
    await slotRow.hover();
    const slotAdd=slotRow.locator('.food-slot-add').first();
    await expect(slotAdd).toBeVisible();
    await expect(slotAdd).toHaveCSS('opacity','1');
    const [labelBox,addBox]=[await slotRow.locator('.food-time-label-main').boundingBox(),await slotAdd.boundingBox()];
    expect(addBox!.y).toBeGreaterThanOrEqual(labelBox!.y+labelBox!.height-1);
    await noHorizontalOverflow(page);

    // Progress: weigh-ins are flat rows, and the delete icon is not red at rest.
    await page.locator('nav button:visible',{hasText:/^Progress$/}).first().click();
    const row=page.locator('.weigh-in-row').first();
    await expect(row).toBeVisible();
    expect(await row.evaluate(element=>getComputedStyle(element).borderLeftWidth)).toBe('0px');
    const resting=await page.locator('.weigh-in-delete').first().evaluate(element=>getComputedStyle(element).color);
    const edit=await page.locator('.weigh-in-actions .button').first().evaluate(element=>getComputedStyle(element).color);
    expect(resting).toBe(edit);
    await noHorizontalOverflow(page);

    // Body: the hub states what is on file and keeps every action.
    await page.getByRole('tab',{name:'Body'}).or(page.getByRole('button',{name:'Body',exact:true})).first().click();
    await expect(page.getByText('No records yet.',{exact:false}).first()).toBeVisible();
    await expect(page.getByText('No photo sets yet.',{exact:false}).first()).toBeVisible();
    for(const name of ['Add body record','Open history','Add photo set','Open gallery'])await expect(page.getByRole('button',{name})).toBeVisible();
    await expect(page.getByRole('button',{name:/^Compare/})).toBeVisible();
    // The heading and Compare share a row at every width (phones used to stack Compare full-width beneath it).
    const [headingBox,compareBox]=[await page.getByRole('heading',{name:'Body',level:2,exact:true}).boundingBox(),await page.getByRole('button',{name:/^Compare/}).boundingBox()];
    expect(compareBox!.y).toBeLessThan(headingBox!.y+headingBox!.height);
    expect(compareBox!.width).toBeLessThan(260);
    // Comparing needs two records, so with none on file it is disabled rather than opening an empty page.
    await expect(page.getByRole('button',{name:/^Compare/})).toBeDisabled();
    await noHorizontalOverflow(page);

    // No visible text on the Dashboard shows an ISO date.
    await page.locator('nav button:visible',{hasText:/^Dashboard$/}).first().click();
    await expect(page.getByRole('heading',{name:'Dashboard',level:1})).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(iso);
    await noHorizontalOverflow(page);
  });
}

test('Quick add and Manual entry are quiet text actions beside the method tabs',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.locator('nav button:visible',{hasText:/^Food Log$/}).first().click();
  await page.getByRole('button',{name:/Log food/}).first().click();
  const quick=page.getByRole('button',{name:'Quick add'});
  const manual=page.getByRole('button',{name:'Manual entry'});
  await expect(quick).toBeVisible();
  // One row, 44 px targets, no filled background competing with the method tabs. The sheet slides in, so poll until it settles.
  await expect.poll(async()=>{const [q,m]=[await quick.boundingBox(),await manual.boundingBox()];return q&&m?Math.abs(q.y-m.y):Infinity;}).toBeLessThan(2);
  expect((await quick.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.mouse.move(0,0);
  await expect(quick).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
});

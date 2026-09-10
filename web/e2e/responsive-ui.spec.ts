import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const credentials={username:'ui-review',password:'nutrition visual review 2026'};
  let response=await request.post('/api/auth/register',{headers,data:credentials});
  for(let attempt=0;response.status()===429&&attempt<12;attempt++){
    await new Promise(resolve=>setTimeout(resolve,5000));
    response=await request.post('/api/auth/register',{headers,data:credentials});
  }
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const save=async(kind:string,data:unknown,recordId=randomUUID())=>{
    const saved=await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId,expectedRevision:0,delete:false,data}});
    expect(saved.ok(),await saved.text()).toBeTruthy();
  };
  await save('profile',{dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0},state.id);
  const preview=await (await request.get('/api/coach/preview')).json();
  expect((await request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}})).ok()).toBeTruthy();
  const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(let offset=13;offset>=0;offset--){
    const day=new Date(`${current}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-offset);
    const date=day.toISOString().slice(0,10);
    await save('weight',{date,kg:80.5+offset*.06+(offset%3)*.12});
    await save('entry',{date,name:'Greek yogurt, berries and rolled oats',calories:420,protein:28,carbs:52,fat:12,fiber:7,quantity:1,unit:'serving',meal:'Breakfast',time:'08:00'});
  }
  await save('entry',{date:current,name:'Grilled chicken with brown rice and vegetables',calories:640,protein:46,carbs:68,fat:18,fiber:9,quantity:1,unit:'serving',meal:'Lunch',time:'12:30'});
  session=await request.storageState();
});

async function contained(page:Page){
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
}
async function capture(page:Page,name:string){
  await contained(page);
  for(const body of await page.locator('.modal-body:visible').all())expect(await body.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBeTruthy();
  await page.screenshot({path:`artifacts/ui-uplift/${name}.png`,fullPage:true,animations:'disabled'});
  await page.screenshot({path:`artifacts/ui-uplift/${name}-viewport.png`,animations:'disabled'});
}

for(const width of [390,768,1440])for(const theme of ['light','dark']){
  test(`${theme} ${width}: navigation, pages and entry surfaces`,async({page,context})=>{
    test.setTimeout(120000);
    await context.addCookies(session.cookies);
    await page.setViewportSize({width,height:900});
    await page.addInitScript(theme=>localStorage.setItem('nourish-theme',theme),theme);
    await page.goto('/');
    await expect(page.getByRole('heading',{name:'Diary',exact:true})).toBeVisible();
    const launcher=page.getByRole('button',{name:'Add entry',exact:true});
    const nav=page.getByRole('navigation',{name:'Main navigation'});
    const sidebar=await page.locator('.sidebar').boundingBox();
    if(width<640){
      await expect(nav.locator('button:visible')).toHaveCount(5);
      const add=await launcher.boundingBox();
      expect(Math.abs(add!.x+add!.width/2-width/2)).toBeLessThanOrEqual(1);
      expect(Math.abs(sidebar!.y+sidebar!.height-900)).toBeLessThanOrEqual(1);
    }else{
      await expect(nav.locator('button:visible')).toHaveCount(6);
      expect(sidebar!.x).toBe(0);
      expect(sidebar!.height).toBe(900);
      expect(sidebar!.width).toBe(width<1024?88:228);
    }
    for(const name of ['Today','Food Log','Progress','Coach','Settings']){
      await page.getByRole('button',{name,exact:true}).click();
      await expect(page.locator('[data-page-heading]')).toHaveText(name==='Today'?'Diary':name);
      await capture(page,`${theme}-${width}-${name.replaceAll(' ','-')}`);
      if(name==='Today'||name==='Food Log'){
        const trigger=page.getByRole('button',{name:name==='Today'?'Choose diary date':'Choose food date',exact:true});
        await trigger.click();
        const calendar=page.locator('.custom-calendar-popover');
        await expect(calendar).toBeVisible();await contained(page);
        const box=await calendar.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x+box!.width).toBeLessThanOrEqual(width);
        await capture(page,`${theme}-${width}-${name.replaceAll(' ','-')}-calendar`);
        await page.keyboard.press('Escape');await expect(calendar).toHaveCount(0);await expect(trigger).toBeFocused();
      }
      if(name==='Progress'){
        const chart=page.locator('.weight-chart').first();
        await expect.poll(()=>chart.evaluate(element=>Math.abs(element.getBoundingClientRect().width-(element as SVGSVGElement).viewBox.baseVal.width))).toBeLessThanOrEqual(1);
      }
      if(name==='Food Log'&&width<640){
        const firstMeal=page.locator('[data-time-row="08:00"]');
        const time=await firstMeal.locator('.food-time-label-main').boundingBox();
        const card=await firstMeal.locator('.food-time-card').boundingBox();
        expect(Math.abs(time!.y-card!.y)).toBeLessThanOrEqual(20);
      }
      if(width<1024){
        const small=await page.locator('button:visible').evaluateAll(buttons=>buttons.filter(button=>{const box=button.getBoundingClientRect();return box.height<43||box.width<43;}).map(button=>button.textContent));
        expect(small).toEqual([]);
      }
      if(name==='Settings'&&width<640){
        await expect(page.locator('.mobile-settings')).toHaveAttribute('aria-current','page');
        await expect(page.locator('.nav-mobile-items .selection-indicator-marker')).toBeHidden();
      }
    }
    await page.getByRole('button',{name:'Progress',exact:true}).click();
    for(const section of ['Energy','Photos']){
      await page.getByRole('button',{name:section,exact:true}).click();
      await capture(page,`${theme}-${width}-Progress-${section}`);
    }
    await page.getByRole('button',{name:'Add photo set',exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page,`${theme}-${width}-Photo-dialog`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await launcher.click();
    const addDialog=page.getByRole('dialog',{name:'Add',exact:true});
    await expect(addDialog).toBeVisible();
    await capture(page,`${theme}-${width}-Add-dialog`);
    await addDialog.getByRole('button',{name:'Log food'}).click();
    const foodDialog=page.getByRole('dialog',{name:'Log food',exact:true});
    await expect(foodDialog).toBeVisible();
    await capture(page,`${theme}-${width}-Food-dialog`);
    await foodDialog.getByRole('button',{name:'Manual entry',exact:true}).click();
    await capture(page,`${theme}-${width}-Manual-entry`);
    await page.keyboard.press('Escape');
    await expect(foodDialog.getByRole('button',{name:'Manual entry',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await launcher.click();
    await addDialog.getByRole('button',{name:'Log weight'}).click();
    await expect(page.getByRole('dialog',{name:'Log weight',exact:true})).toBeVisible();
    await capture(page,`${theme}-${width}-Weight-dialog`);
    await page.keyboard.press('Escape');
    await expect(launcher).toBeFocused();
  });
}

test('phone navigation remains centered at narrow widths and after resizing from the rail',async({page,context})=>{
  await context.addCookies(session.cookies);await page.goto('/');
  await expect(page.getByRole('heading',{name:'Diary',exact:true})).toBeVisible();
  for(const width of [320,639,640,1023,1024,390]){
    await page.setViewportSize({width,height:800});await contained(page);
    const launcher=page.getByRole('button',{name:'Add entry',exact:true});
    const box=await launcher.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    if(width<640)expect(Math.abs(box!.x+box!.width/2-width/2)).toBeLessThanOrEqual(1);
    await launcher.click();await expect(page.getByRole('dialog',{name:'Add',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await expect(launcher).toBeFocused();
  }
});

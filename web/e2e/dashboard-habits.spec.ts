import {test,expect,type APIRequestContext,type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from './signIn';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;
const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
/** Counts matching days across the current and previous month, one page at a time. */
const countAcrossMonths=async(dialog:Locator,text:RegExp)=>{
  // count() does not wait, so settle on the rendered month before each count.
  const heading=dialog.locator('.habit-month-nav h3');
  const days=()=>dialog.locator('.habit-months').getByRole('listitem').filter({hasText:text}).count();
  await expect(dialog.locator('.habit-day[data-today]')).toHaveCount(1);
  const month=(await heading.textContent())??'';
  let total=await days();
  const previous=dialog.getByRole('button',{name:'Previous month'});
  if(await previous.isEnabled()){
    await previous.click();
    await expect(heading).not.toHaveText(month);
    total+=await days();
    await dialog.getByRole('button',{name:'Next month'}).click();
    await expect(heading).toHaveText(month);
  }
  return total;
};
/** Offsets 0 (today) through this one fall in the current Monday-based week. */
const weekdayOffset=(new Date(`${current}T12:00:00Z`).getUTCDay()+6)%7;
const thisWeek=(offsets:number[])=>offsets.filter(offset=>offset<=weekdayOffset).length;
const daysAgo=(offset:number)=>{const day=new Date(`${current}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-offset);return day.toISOString().slice(0,10);};

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const response=await signInApi(request,'habits-review');
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const save=async(kind:string,data:unknown,recordId=randomUUID())=>{
    const saved=await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId,expectedRevision:0,delete:false,data}});
    expect(saved.ok(),await saved.text()).toBeTruthy();
  };
  await save('profile',{dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0},state.id);
  // Food on recent days, one fasting and one not-logging decision (no missed-day prompt), and weigh-ins every other day.
  for(const offset of [1,2,3,4,5,8,9,10])await save('entry',{date:daysAgo(offset),name:'Rolled oats',calories:380,protein:13,carbs:66,fat:7,quantity:1,unit:'serving',time:'08:00'});
  for(const offset of [0,2,4,6,8,10])await save('weight',{date:daysAgo(offset),kg:80+offset*.05});
  await save('day',{date:daysAgo(6),status:'fasting'});
  await save('day',{date:daysAgo(7),status:'not_logged'});
  session=await request.storageState();
});

for(const width of [390,768,1440])for(const theme of ['light','dark']){
  test(`${theme} ${width}: dashboard sections and habit calendars`,async({page,context})=>{
    await context.addCookies(session.cookies);
    await page.setViewportSize({width,height:900});
    await page.addInitScript(value=>localStorage.setItem('nutrition-theme',value),theme);
    await page.goto('/');
    for(const name of ['Today','Habits','Insights & analytics'])await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();

    const food=page.getByRole('button',{name:/^Food logging: /});
    const weight=page.getByRole('button',{name:/^Weigh-ins: /});
    // A fasting day keeps the habit; an explicit not-logging day ends the streak.
    // The headline counts this week's kept days; fasting (6 days ago) counts, not-logging (7) does not.
    const foodWeek=thisWeek([1,2,3,4,5,6,8,9,10]);
    await expect(food).toHaveAccessibleName(new RegExp(`^Food logging: ${foodWeek} of 7 days this week, 6-day streak`));
    await expect(weight).toHaveAccessibleName(new RegExp(`^Weigh-ins: ${thisWeek([0,2,4,6,8,10])} of 7 days this week, 1-day streak`));
    await expect(food.locator('.habit-calendar-count')).toHaveText(`${foodWeek}/7 this week`);

    await page.evaluate(()=>document.fonts.ready);
    // The landing cascade staggers the two cards; measure once it settles.
    await expect.poll(()=>page.evaluate(()=>document.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);
    // Both cards sit side by side at every width, sized to their content, with 44 px targets.
    const foodBox=(await food.boundingBox())!;
    const weightBox=(await weight.boundingBox())!;
    expect(Math.abs(foodBox.y-weightBox.y)).toBeLessThanOrEqual(1);
    // The two thirty-day grids line up even when one title wraps on a phone.
    const foodGrid=(await food.locator('.habit-grid-compact').boundingBox())!;
    const weightGrid=(await weight.locator('.habit-grid-compact').boundingBox())!;
    expect(Math.abs(foodGrid.y-weightGrid.y)).toBeLessThanOrEqual(1);
    expect(foodBox.height).toBeGreaterThanOrEqual(44);
    // The medium navigation rail leaves room for an extra wrapped summary line.
    expect(foodBox.height).toBeLessThan(width<640?260:width<1024?216:200);
    // The compact grid is the last thirty days ending today; the dialog holds the month calendar.
    await expect(food.locator('.habit-cell')).toHaveCount(30);
    await expect(food.locator('.habit-cell').last()).toHaveAttribute('data-today','true');
    await expect(food.locator('.habit-cell[data-status="logged"]')).not.toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:`artifacts/ui-uplift/dashboard-habits-${theme}-${width}.png`,fullPage:true,animations:'disabled'});

    // The card opens the full calendar; Escape closes it and returns focus.
    await food.click();
    const dialog=page.getByRole('dialog',{name:'Food logging'});
    await expect(dialog).toBeVisible();
    // One month at a time, opening on the current month.
    await expect(dialog.locator('.habit-grid-full')).toHaveCount(1);
    await expect(dialog.getByRole('button',{name:'Next month'})).toBeDisabled();
    await expect(dialog.locator('.habit-day[data-today]')).toHaveCount(1);
    expect(await countAcrossMonths(dialog,/Food logged/)).toBe(8);
    expect(await countAcrossMonths(dialog,/Fasting day/)).toBe(1);
    expect(await dialog.locator('.modal-body').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBeTruthy();
    await page.screenshot({path:`artifacts/ui-uplift/dashboard-habits-dialog-${theme}-${width}.png`,animations:'disabled'});
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(food).toBeFocused();

    await weight.click();
    const weighIns=page.getByRole('dialog',{name:'Weigh-ins'});
    expect(await countAcrossMonths(weighIns,/Weighed in/)).toBe(6);
    await page.keyboard.press('Escape');
  });
}

import {test,expect,type APIRequestContext,type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from './signIn';
import {longDate} from '../src/lib/format';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;
const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const daysAgo=(offset:number)=>{const day=new Date(`${current}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-offset);return day.toISOString().slice(0,10);};
/** Days since Monday: offsets 0 through this one fall in the current Monday-based week. */
const weekdayOffset=(new Date(`${current}T12:00:00Z`).getUTCDay()+6)%7;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const response=await signInApi(request,'insights-review');
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const save=async(kind:string,data:unknown,recordId=randomUUID())=>{
    const saved=await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId,expectedRevision:0,delete:false,data}});
    expect(saved.ok(),await saved.text()).toBeTruthy();
  };
  await save('profile',{dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0},state.id);
  const preview=await (await request.get('/api/coach/preview')).json();
  expect((await request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}})).ok()).toBeTruthy();
  // Food on every past day keeps the missed-day prompt away; weigh-ins give the trend a week of history.
  for(let offset=10;offset>=0;offset--){
    await save('entry',{date:daysAgo(offset),name:'Rolled oats',calories:380,protein:13,carbs:66,fat:7,quantity:1,unit:'serving',time:'08:00'});
    await save('weight',{date:daysAgo(offset),kg:81-offset*.1});
  }
  session=await request.storageState();
});

test.beforeEach(async({request})=>{
  const state=await (await request.get('/api/state')).json();
  if(state.settings?.weightChartView&&state.settings.weightChartView!=='trend'){
    await request.post('/api/sync',{headers,data:{id:randomUUID(),kind:'settings',recordId:state.id,expectedRevision:state.settings.revision,delete:false,data:{weightChartView:'trend'}}});
  }
});

for(const [width,theme] of [[390,'light'],[390,'dark'],[768,'light'],[1440,'dark']] as const){
  test(`${theme} ${width}: this week and weight trend insights`,async({page,context})=>{
    await context.addCookies(session.cookies);
    await page.setViewportSize({width,height:900});
    await page.addInitScript(value=>localStorage.setItem('nutrition-theme',value),theme);
    await page.goto('/');
    const week=page.getByRole('group',{name:'Days this week'});
    const days=week.getByRole('button');
    await expect(days).toHaveCount(7);
    const card=page.locator('.week-nutrition');
    const caption=card.locator('.week-nutrition-caption');

    // Today opens selected and boxed, with its intake against the accepted target.
    const todayButton=week.locator(`[data-selection-key="${current}"]`);
    await expect(todayButton).toHaveAttribute('aria-pressed','true');
    await expect(todayButton).toHaveAttribute('data-today','true');
    await expect(todayButton).toHaveAccessibleName(new RegExp(`^${longDate(current)}, today: 380 of [\\d,]+ kcal, protein 13 of [\\d,]+ g`));
    await expect(caption).toHaveText(`Today · ${longDate(current)}`);
    await expect(card.locator('.week-nutrition-figure.calories strong')).toHaveText('380');

    if(weekdayOffset>0){
      // The plan was accepted today, so earlier days have intake but no target to compare against.
      const monday=week.locator(`[data-selection-key="${daysAgo(weekdayOffset)}"]`);
      await expect(monday).toHaveAccessibleName(new RegExp(`^${longDate(daysAgo(weekdayOffset))}: 380 of no target`));
      await monday.click();
      await expect(monday).toHaveAttribute('aria-pressed','true');
      await expect(caption).toHaveText(longDate(daysAgo(weekdayOffset)));
      await expect(card.locator('.week-nutrition-figure.calories small')).toHaveText('/ — kcal');
      // Selecting the same day again shows the average of the week's past logged days.
      await monday.click();
      await expect(days.and(page.locator('[aria-pressed="true"]'))).toHaveCount(0);
      await expect(caption).toHaveText(`Daily average · ${weekdayOffset} logged ${weekdayOffset===1?'day':'days'} before today`);
      await expect(card.locator('.week-nutrition-figure.calories strong')).toHaveText('380');
    }
    if(weekdayOffset<6){
      await expect(week.locator(`[data-selection-key="${daysAgo(weekdayOffset-6)}"]`)).toHaveAttribute('data-status','future');
    }
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    // Every day is at least a 44 px target at every width.
    for(const box of await days.evaluateAll(buttons=>buttons.map(button=>button.getBoundingClientRect().toJSON())))expect(Math.min(box.width,box.height)).toBeGreaterThanOrEqual(44);
    await page.screenshot({path:`artifacts/ui-uplift/dashboard-insights-${theme}-${width}.png`,fullPage:true,animations:'disabled'});

    // The Weight card summarizes the cleaned trend, then swipes to the scale readings and to both
    // together; the latest weigh-ins sit in their own card at the foot of the Dashboard.
    const weight=page.locator('.weight-progress-card');
    await weight.scrollIntoViewIfNeeded();
    await expect(weight.getByRole('heading',{name:'Weight',exact:true})).toBeVisible();
    const carousel=weight.getByRole('group',{name:'Weight view',exact:true});
    const title=carousel.locator('.swipe-carousel-title');
    await expect(title).toHaveText('Trend weight');
    const figure=/^[+−-]?[\d.]+ kg$/;
    const stat=(slide:Locator,label:string)=>slide.locator('.energy-stats > div').filter({hasText:label}).locator('dd');
    const trendSlide=carousel.getByRole('group',{name:'Trend weight, 1 of 3'});
    await expect(stat(trendSlide,'Trend weight')).toHaveText(figure);
    await expect(stat(trendSlide,'Change in trend')).toHaveText(figure);
    await expect(trendSlide.locator('.weight-chart-panel')).toBeVisible();
    // Phones swipe the track; from 640 px the arrows beside the view name do the same.
    const showView=async(index:number,name:string)=>{
      if(width>=640)await carousel.getByRole('button',{name:`Next view: ${name}`,exact:true}).click();
      else await carousel.locator('.swipe-carousel-track').evaluate((track,n)=>track.scrollTo({left:track.clientWidth*n,behavior:'instant'}),index);
      await expect(title).toHaveText(name);
      await expect(carousel.getByRole('group',{name:`${name}, ${index+1} of 3`})).toBeVisible();
    };
    await showView(1,'Scale weight');
    const scaleSlide=carousel.getByRole('group',{name:'Scale weight, 2 of 3'});
    await expect(stat(scaleSlide,'Average scale weight')).toHaveText(figure);
    await expect(stat(scaleSlide,'Lowest')).toHaveText(/^80(\.0)? kg$/);
    await expect(stat(scaleSlide,'Highest')).toHaveText(/^81(\.0)? kg$/);
    await showView(2,'Trend and scale weight');
    await expect(carousel.getByRole('group',{name:'Trend and scale weight, 3 of 3'}).locator('.energy-stats > div')).toHaveCount(3);

    const history=page.locator('.weight-history-card');
    await history.scrollIntoViewIfNeeded();
    await expect(history.getByRole('heading',{name:'Latest weigh-ins'})).toBeInViewport();
    await expect(history.locator('.weigh-in-list .weigh-in-row').first()).toBeVisible();
  });
}

test('reduced motion shows the week bars at once',async({browser})=>{
  const context=await browser.newContext({baseURL:origin,reducedMotion:'reduce',storageState:session});
  const page=await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('group',{name:'Days this week'}).getByRole('button')).toHaveCount(7);
  expect(await page.locator('.week-nutrition').evaluate(element=>element.getAnimations({subtree:true}).length)).toBe(0);
  await context.close();
});

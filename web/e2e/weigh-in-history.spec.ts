import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {seedMobileUser,testOrigin,todayInTestZone} from './helpers/seed';

const headers={Origin:testOrigin,'X-Nutrition-Request':'1'};
// Seven recent weigh-ins come from the seed; these reach back past the server's first ten rows.
const OLDER_DAYS=Array.from({length:60},(_,index)=>7+index);

test.beforeEach(async({page,request,context})=>{
  const session=await seedMobileUser(request,'weigh-in-history',[{name:'Overnight oats',time:'08:00',calories:410}]);
  for(const offset of OLDER_DAYS){
    const day=new Date(`${todayInTestZone()}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-offset);
    const date=day.toISOString().slice(0,10);
    const save=async(kind:string,data:unknown)=>{
      const response=await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId:randomUUID(),expectedRevision:0,delete:false,data}});
      expect(response.ok()).toBeTruthy();
    };
    await save('weight',{date,kg:80+(offset%7)*.1});
    // Food on every past day keeps the missed-day prompt from covering the page.
    await save('entry',{date,name:'Porridge',calories:350,protein:12,carbs:55,fat:8,fiber:6,quantity:1,unit:'serving',time:'07:00'});
  }
  await context.addCookies(session.cookies);
  await page.goto('/');
  const period=page.getByLabel('Weight history period',{exact:true});
  await period.scrollIntoViewIfNeeded();
  await period.selectOption('six-months');
});

test('the weigh-in list pages in older rows until the whole period is shown',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const rows=page.locator('.weight-history-panel .weigh-in-list > li');
  const count=page.locator('.weigh-in-count');
  await expect(rows).toHaveCount(7);
  const total=Number((await count.textContent())!.match(/of (\d+)/)![1]);
  expect(total).toBe(7+OLDER_DAYS.filter(offset=>offset<=183).length);
  await page.locator('.weight-history-card').getByRole('button',{name:'Show more',exact:true}).click();
  // Past the summary's ten rows: the first page arrived from the history endpoint.
  await expect.poll(()=>rows.count()).toBeGreaterThan(10);
  // Reaching the end of the open list reads further pages without another tap.
  await expect.poll(async()=>{
    await page.locator('.weigh-in-more').scrollIntoViewIfNeeded();
    return rows.count();
  },{timeout:30000}).toBe(total);
  await expect(count).toHaveText(`Showing ${total} of ${total}`);
  const dates=await rows.locator('time').evaluateAll(items=>items.map(item=>item.getAttribute('dateTime')!));
  expect(new Set(dates).size).toBe(total);
  expect([...dates].sort().reverse()).toEqual(dates);
  await page.locator('.weight-history-card').getByRole('button',{name:'Show fewer',exact:true}).click();
  await expect(rows).toHaveCount(7);
});

test('six months fit a desktop chart, a year scrolls, and a phone scrolls six months',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  // Only the slide in view is interactive; the other two views of the carousel are inert.
  const weightCard=page.locator('.weight-progress-card');
  const scroller=weightCard.locator('.swipe-carousel-slide:not([inert]) .bar-chart-scroller');
  await scroller.scrollIntoViewIfNeeded();
  const overflow=()=>scroller.evaluate(element=>element.scrollWidth-element.clientWidth);
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  await expect(weightCard.locator('.swipe-carousel-slide:not([inert])').getByRole('button',{name:'Show earlier days'})).toHaveCount(0);
  await page.getByLabel('Weight history period',{exact:true}).selectOption('year');
  await expect.poll(overflow).toBeGreaterThan(1);
  await expect(weightCard.locator('.swipe-carousel-slide:not([inert])').getByRole('button',{name:'Show earlier days'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel('Weight history period',{exact:true}).selectOption('six-months');
  await expect.poll(overflow).toBeGreaterThan(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

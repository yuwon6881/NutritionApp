import {test,expect,type Locator} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {seedMobileUser,testOrigin,todayInTestZone} from './helpers/seed';

const headers={Origin:testOrigin,'X-Nutrition-Request':'1'};

// The carousel's track is a native scroll-snap scroller, so scrolling it is what a swipe does; this
// works at every window size, unlike the arrows, which are only reachable by pointer from 640 px.
const showView=async(card:Locator,index:number)=>{
  await card.locator('.swipe-carousel-track').evaluate((track,n)=>track.scrollTo({left:track.clientWidth*n,behavior:'instant'}),index);
  await expect(card.locator('.swipe-carousel-slide').nth(index)).not.toHaveAttribute('inert');
};
const activeSlide=(card:Locator)=>card.locator('.swipe-carousel-slide:not([inert])');

test.beforeEach(async({page,request,context})=>{
  const session=await seedMobileUser(request,'dashboard-chart-views',[{name:'Overnight oats',time:'08:00',calories:410}]);
  // Older weigh-ins push the month past the ten rows the server lists.
  for(let offset=7;offset<=17;offset++){
    const day=new Date(`${todayInTestZone()}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-offset);
    const date=day.toISOString().slice(0,10);
    const save=async(kind:string,data:unknown)=>{
      const response=await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId:randomUUID(),expectedRevision:0,delete:false,data}});
      expect(response.ok()).toBeTruthy();
    };
    await save('weight',{date,kg:80+offset*.05});
    // Food on every past day keeps the missed-day prompt from covering the page.
    await save('entry',{date,name:'Porridge',calories:350,protein:12,carbs:55,fat:8,fiber:6,quantity:1,unit:'serving',time:'07:00'});
  }
  await context.addCookies(session.cookies);
  await page.goto('/');
  // The chart cards load lazily after the Dashboard's first paint.
  await expect(page.locator('.weight-progress-card')).toBeVisible();
});

test('saved weigh-ins beyond the listed rows do not leave the sync notice or a pending trend',async({page})=>{
  const card=page.locator('.weight-progress-card');
  await expect(activeSlide(card).locator('.energy-stats').getByText('Trend weight',{exact:true})).toBeVisible();
  await expect(page.getByText('Recent edits will update after sync.')).toHaveCount(0);
  await expect(page.getByText('Pending sync')).toHaveCount(0);
});

test('the weight card swipes between trend, scale, and both views with their own figures and chart',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const card=page.locator('.weight-progress-card');
  const stats=(view:number)=>card.locator('.swipe-carousel-slide').nth(view).locator('.energy-stats dt');
  await expect(card.locator('.swipe-carousel-title')).toHaveText('Trend weight');
  await expect(stats(0)).toHaveText(['Trend weight','Change in trend']);
  await expect(card.getByRole('img',{name:/^Trend weight chart across \d+ weigh-ins\.$/})).toBeVisible();

  await showView(card,1);
  await expect(card.locator('.swipe-carousel-title')).toHaveText('Scale weight');
  await expect(stats(1)).toHaveText(['Average scale weight','Lowest','Highest']);
  await expect(card.getByRole('img',{name:/^Scale weight chart across \d+ weigh-ins\.$/})).toBeVisible();

  await showView(card,2);
  await expect(card.locator('.swipe-carousel-title')).toHaveText('Trend and scale');
  await expect(stats(2)).toHaveText(['Trend weight','Average scale weight','Change in trend']);
  await expect(card.getByRole('img',{name:/^Scale and trend weight chart across \d+ weigh-ins\.$/})).toBeVisible();
});

test('the pager arrows change the weight view and loop round at both ends',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const card=page.locator('.weight-progress-card');
  const title=card.locator('.swipe-carousel-title');
  await card.getByRole('button',{name:'Next view: Scale weight'}).click();
  await expect(title).toHaveText('Scale weight');
  await expect(card.getByRole('group',{name:'Scale weight, 2 of 3'})).not.toHaveAttribute('inert');
  await card.getByRole('button',{name:'Next view: Trend and scale'}).click();
  await expect(title).toHaveText('Trend and scale');
  // Past the last view comes the first, and before the first the last.
  await card.getByRole('button',{name:'Next view: Trend weight'}).click();
  await expect(title).toHaveText('Trend weight');
  await expect(card.getByRole('group',{name:'Trend weight, 1 of 3'})).not.toHaveAttribute('inert');
  await card.getByRole('button',{name:'Previous view: Trend and scale'}).click();
  await expect(title).toHaveText('Trend and scale');
});

test('on a phone the pager is visible and tappable, with no swipe hint text',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const card=page.locator('.weight-progress-card');
  await expect(card.getByText(/swipe for more/i)).toHaveCount(0);
  const next=card.getByRole('button',{name:'Next view: Scale weight'});
  await expect(next).toBeVisible();
  const box=await next.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(43);
  expect(box!.height).toBeGreaterThanOrEqual(43);
  await next.click();
  await expect(card.locator('.swipe-carousel-title')).toHaveText('Scale weight');
});

test('energy charts switch between intake and balance, with a readout for the selected day',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const card=page.locator('.energy-progress-card');
  await expect(card).toBeVisible();
  // Inactive slides stay in the document but are inert, so look only inside the view that is showing.
  const slide=activeSlide(card);
  const intake=slide.getByRole('img',{name:/Energy intake bars/});
  const balance=slide.getByRole('img',{name:/^Surplus or deficit by/});
  await expect(intake).toBeVisible();
  await expect(balance).toHaveCount(0);
  const readout=slide.locator('.energy-readout');
  for(const label of ['Intake','Maintenance','Balance'])await expect(readout.getByText(label,{exact:true})).toBeVisible();
  await card.getByRole('button',{name:'Next view: Surplus or deficit'}).click();
  await expect(card.locator('.swipe-carousel-title')).toHaveText('Surplus or deficit');
  await expect(balance).toBeVisible();
  await expect(intake).toHaveCount(0);
});

test('the weight chart fits a month or a week without scrolling on a desktop window',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const card=page.locator('.weight-progress-card');
  const scroller=activeSlide(card).locator('.bar-chart-scroller');
  const widths=()=>scroller.evaluate(element=>({content:element.scrollWidth,view:element.clientWidth}));
  // The whole period shows at once whenever every day keeps a readable width.
  await expect.poll(async()=>{const {content,view}=await widths();return Math.abs(content-view)<=1;}).toBe(true);
  await expect(card.getByRole('button',{name:'Show earlier days'})).toHaveCount(0);
  await page.getByLabel('Weight history period',{exact:true}).selectOption('week');
  await expect.poll(async()=>{const {content,view}=await widths();return Math.abs(content-view)<=1;}).toBe(true);
  await expect(card.getByRole('button',{name:'Show earlier days'})).toHaveCount(0);
});

test('the weight chart scrolls sideways on a phone when a year does not fit',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel('Weight history period',{exact:true}).selectOption('year');
  const scroller=activeSlide(page.locator('.weight-progress-card')).locator('.bar-chart-scroller');
  await expect.poll(()=>scroller.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeGreaterThan(1);
});

test('the maintenance chart shades the days the estimate held',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const card=page.locator('.energy-progress-card');
  await expect(card).toBeVisible();
  await showView(card,2);
  const panel=card.locator('.maintenance-chart-panel');
  await expect(panel.getByRole('img',{name:/^Estimated maintenance across \d+ days; held on [1-9]\d* of them\.$/})).toBeVisible();
  // Eleven days of weigh-ins cannot span the 21 days adaptation needs, so the estimate is held.
  await expect(panel.locator('.maintenance-status.is-holding').first()).toHaveText('More weigh-ins');
  await expect(panel.locator('.maintenance-hold-band').first()).toBeVisible();
  // A held estimate can be perfectly flat, which Playwright treats as zero-size, so count rather than test visibility.
  await expect(panel.locator('.maintenance-trend-line.is-held')).not.toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

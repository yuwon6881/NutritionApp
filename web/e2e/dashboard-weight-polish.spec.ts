import {test,expect,type Locator} from '@playwright/test';
import {seedMobileUser,todayInTestZone} from './helpers/seed';

// The carousel track is a native scroll-snap scroller; scrolling it is what a swipe does.
const showView=async(card:Locator,index:number)=>{
  await card.locator('.swipe-carousel-track').evaluate((track,n)=>track.scrollTo({left:track.clientWidth*n,behavior:'instant'}),index);
  await expect(card.locator('.swipe-carousel-slide').nth(index)).not.toHaveAttribute('inert');
};
const activeSlide=(card:Locator)=>card.locator('.swipe-carousel-slide:not([inert])');

const days=(count:number)=>Array.from({length:count},(_,index)=>{
  const day=new Date(`${todayInTestZone()}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-(count-1-index));
  return {date:day.toISOString().slice(0,10),count:4000+index*100};
});

test.beforeEach(async({page,request,context})=>{
  const session=await seedMobileUser(request,'dashboard-weight-polish',[]);
  await context.addCookies(session.cookies);
  await page.route('**/api/integrations/google-health/sync',route=>route.fulfill({json:{
    status:'connected',connectedAt:'2026-01-01T00:00:00Z',lastSyncedAt:new Date().toISOString(),freshness:'fresh',days:days(30),
    weightSync:{enabled:false,permissionGranted:false,state:'disabled',pendingCount:0,lastSuccessfulSyncAt:null,revision:0},
  }}));
});

for(const width of [390,1440])test(`steps calculator opens as an empty dialog and steps chart pager follows the window size at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/');
  const card=page.locator('.activity-card');
  await expect(card).toBeVisible();
  await expect(page.getByRole('textbox',{name:/Energy to burn/})).toHaveCount(0);
  await page.getByRole('button',{name:'Steps for an energy target'}).click();
  const dialog=page.getByRole('dialog',{name:'Steps calculator'});
  const energy=dialog.getByRole('spinbutton',{name:/Energy to burn/});
  await expect(energy).toHaveValue('');
  expect(await energy.getAttribute('placeholder')).toBeNull();
  await energy.fill('300');
  await expect(dialog.getByText('extra steps')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const steps=activeSlide(card);
  const later=steps.getByRole('button',{name:'Show earlier days'});
  if(width>=1024){
    await expect(later).toBeVisible();
    const before=await steps.locator('.bar-chart-scroller').first().evaluate(element=>element.scrollLeft);
    await later.click();
    await expect.poll(()=>steps.locator('.bar-chart-scroller').first().evaluate(element=>element.scrollLeft)).toBeLessThan(before);
  }else await expect(later).toBeHidden();
});

test('Ask AI opens settled and focused on desktop',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.route('**/api/ai/conversation',route=>route.fulfill({json:{conversationId:'11111111-1111-1111-1111-111111111111',conversationVersion:1,state:null,messages:[],pendingActionBatches:[]}}));
  await page.goto('/');
  await page.getByRole('button',{name:'Ask AI',exact:true}).last().click();
  const dialog=page.getByRole('dialog',{name:'Ask AI',exact:true});
  await expect(dialog).toBeVisible();
  await expect.poll(()=>dialog.locator('.modal-surface').evaluate(element=>getComputedStyle(element).opacity)).toBe('1');
  await expect(dialog.getByLabel('Message',{exact:true})).toBeFocused();
});

test('the day after today can be opened from the strip and arrow keys, without past-day controls',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  const strip=page.getByRole('group',{name:'Choose a food day'});
  const tomorrow=new Date(`${todayInTestZone()}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const dayAfter=new Date(tomorrow);dayAfter.setUTCDate(dayAfter.getUTCDate()+1);
  await strip.locator(`[data-date="${tomorrow.toISOString().slice(0,10)}"]`).click();
  await expect(page.locator('.food-day-summary h2')).toHaveText('Tomorrow');
  await expect(page.getByLabel('Logging status')).toHaveCount(0);
  await expect(strip.locator(`[data-date="${dayAfter.toISOString().slice(0,10)}"]`)).toBeDisabled();
  await strip.locator(`[data-date="${todayInTestZone()}"]`).click();
  await expect(page.locator('.food-day-summary h2')).toHaveText('Today');
});

test('the Energy card loads into a chart-shaped placeholder, not a line of text',async({page})=>{
  await page.route('**/api/progress/summary**',async route=>{
    await new Promise(resolve=>setTimeout(resolve,1500));
    await route.continue();
  });
  await page.goto('/');
  const card=page.locator('.energy-progress-card');
  const slide=activeSlide(card);
  const placeholder=slide.locator('.energy-history .skeleton-chart');
  await expect(placeholder).toBeVisible();
  await expect(slide.locator('.energy-history .skeleton-stats')).toBeVisible();
  await expect(page.getByText('Loading…',{exact:true})).toHaveCount(0);
  await expect(card.getByRole('heading',{name:'Energy',exact:true})).toBeVisible();
  // The placeholder gives way to the real summary without leaving anything behind.
  await expect(placeholder).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});

for(const width of [320,390])test(`Dashboard weight and energy figure rows keep every value inside its card at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/');
  const inside=async(card:Locator)=>{
    await expect(card).toBeVisible();
    const cells=activeSlide(card).locator('.energy-stats > div > dd');
    await expect(cells.first()).toBeVisible();
    for(const cell of await cells.all()){
      const overflow=await cell.evaluate(element=>{
        const row=element.closest('.energy-stats')!.getBoundingClientRect();
        const box=element.getBoundingClientRect();
        return {left:box.left-row.left,right:row.right-box.right,scroll:element.scrollWidth-element.clientWidth};
      });
      expect(overflow.left).toBeGreaterThanOrEqual(-.5);
      expect(overflow.right).toBeGreaterThanOrEqual(-.5);
      expect(overflow.scroll).toBeLessThanOrEqual(0);
    }
  };
  const weight=page.locator('.weight-progress-card');
  await inside(weight);
  await showView(weight,1);
  await inside(weight);
  await inside(page.locator('.energy-progress-card'));
});

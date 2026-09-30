import {test,expect} from '@playwright/test';
import {seedMobileUser,todayInTestZone} from './helpers/seed';

const days=(count:number)=>Array.from({length:count},(_,index)=>{
  const day=new Date(`${todayInTestZone()}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-(count-1-index));
  return {date:day.toISOString().slice(0,10),count:4000+index*100};
});

test.beforeEach(async({page,request,context})=>{
  const session=await seedMobileUser(request,'progress-polish',[]);
  await context.addCookies(session.cookies);
  await page.route('**/api/integrations/google-health/sync',route=>route.fulfill({json:{
    status:'connected',connectedAt:'2026-01-01T00:00:00Z',lastSyncedAt:new Date().toISOString(),freshness:'fresh',days:days(30),
    weightSync:{enabled:false,permissionGranted:false,state:'disabled',pendingCount:0,lastSuccessfulSyncAt:null,revision:0},
  }}));
});

for(const width of [390,1440])test(`steps calculator opens as an empty dialog and chart pager follows the window size at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/');
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await page.getByRole('button',{name:'Activity',exact:true}).click();
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

  const later=page.getByRole('button',{name:'Show earlier days'});
  if(width>=1024){
    await expect(later).toBeVisible();
    const before=await page.locator('.bar-chart-scroller').first().evaluate(element=>element.scrollLeft);
    await later.click();
    await expect.poll(()=>page.locator('.bar-chart-scroller').first().evaluate(element=>element.scrollLeft)).toBeLessThan(before);
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

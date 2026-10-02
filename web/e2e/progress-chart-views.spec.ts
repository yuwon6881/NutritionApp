import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {seedMobileUser,testOrigin,todayInTestZone} from './helpers/seed';

const headers={Origin:testOrigin,'X-Nutrition-Request':'1'};

test.beforeEach(async({page,request,context})=>{
  const session=await seedMobileUser(request,'progress-chart-views',[{name:'Overnight oats',time:'08:00',calories:410}]);
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
  await page.getByRole('button',{name:'Progress',exact:true}).click();
});

test('saved weigh-ins beyond the listed rows do not leave the sync notice or a pending trend',async({page})=>{
  await expect(page.getByText('TREND WEIGHT',{exact:true})).toBeVisible();
  await expect(page.getByText('Recent edits will update after sync.')).toHaveCount(0);
  await expect(page.getByText('Pending sync')).toHaveCount(0);
});

test('energy charts switch between intake and balance, with a readout for the selected day',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Energy',exact:true}).click();
  const intake=page.getByRole('img',{name:/Energy intake bars/});
  const balance=page.getByRole('img',{name:/^Surplus or deficit by/});
  await expect(intake).toBeVisible();
  await expect(balance).toHaveCount(0);
  const readout=page.locator('.energy-readout');
  for(const label of ['Intake','Maintenance','Balance'])await expect(readout.getByText(label,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Surplus or deficit',exact:true}).click();
  await expect(balance).toBeVisible();
  await expect(intake).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Surplus or deficit',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('the weight chart fills the width for a week and scrolls with page buttons for a month',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const scroller=page.locator('.weight-chart-panel .bar-chart-scroller');
  const widths=()=>scroller.evaluate(element=>({content:element.scrollWidth,view:element.clientWidth}));
  // A month holds more days than one expanded window shows.
  await expect.poll(async()=>(await widths()).content).toBeGreaterThan((await widths()).view+1);
  await expect(page.getByRole('button',{name:'Show earlier days'})).toBeVisible();
  await page.getByLabel('Weight history period',{exact:true}).selectOption('week');
  await expect.poll(async()=>{const {content,view}=await widths();return Math.abs(content-view)<=1;}).toBe(true);
  await expect(page.getByRole('button',{name:'Show earlier days'})).toHaveCount(0);
});

test('the weight chart scrolls sideways on a phone',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const scroller=page.locator('.weight-chart-panel .bar-chart-scroller');
  await expect.poll(()=>scroller.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeGreaterThan(1);
});

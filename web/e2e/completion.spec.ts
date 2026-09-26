import {randomUUID} from 'node:crypto';
import {expect,test,type Page} from '@playwright/test';
import {signInApi} from './signIn';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shifted=(days:number)=>new Date(Date.parse(`${current}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);

async function seed(page:Page,proteinGrams:number|null=null){
  expect((await page.request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  expect((await signInApi(page.request)).ok()).toBeTruthy();
  const state=await (await page.request.get('/api/state')).json();
  expect((await page.request.post('/api/sync',{headers,data:{id:randomUUID(),kind:'settings',recordId:state.id,expectedRevision:state.settings.revision,delete:false,data:{...state.settings,missingDayAction:'not_logged'}}})).ok()).toBeTruthy();
  expect((await page.request.post('/api/sync',{headers,data:{id:randomUUID(),kind:'profile',recordId:state.id,expectedRevision:state.profileRevision,delete:false,data:{dateOfBirth:'1996-03-14',age:30,heightCm:175,weightKg:80,sex:'male',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',proteinGrams}}})).ok()).toBeTruthy();
  for(const date of [shifted(-45),shifted(-1),current]){
    expect((await page.request.post('/api/sync',{headers,data:{id:randomUUID(),kind:'weight',recordId:randomUUID(),expectedRevision:0,delete:false,data:{date,kg:80,context:null}}})).ok()).toBeTruthy();
  }
  expect((await page.request.post('/api/sync',{headers,data:{id:randomUUID(),kind:'day',recordId:randomUUID(),expectedRevision:0,delete:false,data:{date:shifted(-1),status:'not_logged'}}})).ok()).toBeTruthy();
  expect((await page.request.post('/api/sync',{headers,data:{id:randomUUID(),kind:'entry',recordId:randomUUID(),expectedRevision:0,delete:false,data:{date:current,time:'12:00',name:'Review meal',calories:300,protein:20,carbs:40,fat:6,fiber:null,source:'manual',quantity:1,unit:'serving'}}})).ok()).toBeTruthy();
  await page.goto('/');
}

for(const width of [390,768,1440])for(const theme of ['light','dark'] as const){
  test(`retained weights and Close/Back stay honest at ${width}px ${theme}`,async({page,context})=>{
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.addInitScript(value=>localStorage.setItem('nourish-theme',value),theme);
    await seed(page);
    await page.getByRole('button',{name:'Progress',exact:true}).click();
    await page.getByLabel('Weight history period',{exact:true}).selectOption('all');
    const table=page.getByRole('table');
    await page.getByText('Values as a table',{exact:true}).click();
    await expect(table.getByText(shifted(-45),{exact:true})).toBeVisible();
    await context.setOffline(true);
    await page.getByRole('button',{name:'Edit',exact:true}).first().click();
    await page.getByLabel('Weight (kg)',{exact:true}).fill('80.2');
    await page.getByRole('button',{name:'Update weigh-in',exact:true}).click();
    await expect(table.getByRole('row').filter({hasText:current}).getByText('Pending',{exact:true})).toBeVisible();
    await expect(table.getByText(shifted(-45),{exact:true})).toBeVisible();
    await context.setOffline(false);
    await page.getByRole('button',{name:'Food Log',exact:true}).click();
    await page.getByRole('button',{name:'Review meal',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Edit food',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading',{name:'Edit food',exact:true})).not.toBeVisible();
    const launcher=page.getByRole('button',{name:'Log food',exact:true});
    await launcher.click();
    await page.getByRole('button',{name:'Manual entry',exact:true}).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Manual entry',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Manual entry',exact:true}).click();
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(launcher).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  });
}

test('a new terminal rejection permits the next independent write in the same drain',async({page,context})=>{
  await seed(page);
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await expect(page.getByRole('button',{name:'Edit',exact:true}).first()).toBeVisible();
  await context.setOffline(true);
  for(const index of [0,1]){
    await page.getByRole('button',{name:'Edit',exact:true}).nth(index).click();
    await page.getByLabel('Weight (kg)',{exact:true}).fill('80.2');
    await page.getByRole('button',{name:'Update weigh-in',exact:true}).click();
  }
  const calls:string[]=[];
  const retry=page.getByRole('button',{name:'Retry connection',exact:true});
  await expect(retry).toBeEnabled();
  const frozenTime=new Date(Date.now()+10000);
  await page.clock.install({time:frozenTime});
  await page.clock.pauseAt(frozenTime);
  await page.route('**/api/sync',async route=>{
    if(route.request().postDataJSON().kind!=='weight'){await route.continue();return;}
    calls.push(route.request().postDataJSON().recordId);
    if(calls.length===1)await route.fulfill({status:400,json:{message:'Test terminal rejection'}});
    else await route.continue();
  });
  await context.setOffline(false);
  await retry.click({force:true});
  let elapsed=0;
  await expect.poll(async()=>{await page.clock.runFor(1);elapsed++;return calls.length;},{timeout:10000}).toBe(2);
  // Allow only event-loop ticks, far short of a foreground or periodic retry.
  expect(elapsed).toBeLessThan(100);
  expect(calls[1]).not.toBe(calls[0]);
  await expect(page.getByText('Test terminal rejection',{exact:true})).toBeVisible();
});

test('cached training remains visible while a refresh is pending',async({page})=>{
  const summary={id:'cached',status:'completed',localDate:current,startedAt:null,finishedAt:null,workoutName:'Cached training',muscleGroups:[],workingSetCount:4,externalVolumeKg:null,systemVolumeKg:null,averageRpe:null};
  let requests=0;
  let complete:()=>void=()=>{};
  const waiting=new Promise<void>(resolve=>{complete=resolve;});
  await page.route('**/api/training/summary',async route=>{
    if(++requests>1)await waiting;
    await route.fulfill({status:200,json:{summaries:[summary],workoutConnected:true,workoutWarning:null}});
  });
  await seed(page);
  await expect(page.getByText('Cached training',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Refreshing workouts'})).toBeVisible();
  complete();
  await expect(page.getByText('Refreshing workouts… Saved summaries remain visible.',{exact:true})).not.toBeVisible();
});

test('a protein override exceeding the energy budget blocks plan progression',async({page})=>{
  await seed(page,600);
  await page.getByRole('button',{name:'Coach',exact:true}).click();
  for(const next of ['Activity','Goal','Details','Macros'])
    await page.getByRole('button',{name:`Next: ${next}`,exact:true}).click();
  await expect(page.getByText('Protein and fat exceed the calorie target. Review your protein override.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Next: Distribution',exact:true})).toBeDisabled();
});

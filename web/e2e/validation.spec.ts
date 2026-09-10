import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;
test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const data={username:'test-validation',password:'validation test password 2026'};
  let response=await request.post('/api/auth/login',{headers,data});
  for(let attempt=0;response.status()===429&&attempt<12;attempt++){
    await new Promise(resolve=>setTimeout(resolve,5000));response=await request.post('/api/auth/login',{headers,data});
  }
  if(response.status()===401)response=await request.post('/api/auth/register',{headers,data});
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const saved=await request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,delete:false,data:{
    age:30,dateOfBirth:'1996-03-14',heightCm:170,weightKg:80,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,
    proteinGrams:null,resistanceTraining:false,pregnancyOrBreastfeeding:false,medicalNutrition:false,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0,
  }}});
  expect(saved.ok(),await saved.text()).toBeTruthy();session=await request.storageState();
});
async function food(page:Page){
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Add',exact:true}).getByRole('button',{name:'Log food',exact:true}).click();
}

test('application errors replace native bubbles on blur and submit in both themes',async({page})=>{
  let writes=0;
  await page.route('**/api/auth/login',route=>{writes++;return route.fulfill({status:400,json:{message:'Invalid username or password.'}});});
  await page.goto('/');
  await expect(page.locator('.field-error')).toHaveCount(0);
  await page.getByLabel('Username',{exact:true}).focus();await page.getByLabel('Password',{exact:true}).focus();
  await expect(page.getByText('Enter username.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByLabel('Username',{exact:true})).toBeFocused();
  expect(writes).toBe(0);expect(await page.locator('form').evaluate((form:HTMLFormElement)=>form.noValidate)).toBe(true);
  for(const width of [390,768,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/validation-${width}-${theme}.png`,fullPage:true});
  }
  await page.getByLabel('Username',{exact:true}).fill('valid-user');
  await expect(page.getByLabel('Username',{exact:true})).not.toHaveAttribute('aria-invalid','true');
  await page.getByRole('button',{name:'New here? Create an account'}).click();
  await page.getByLabel('Password',{exact:true}).fill('short');await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByText('Use at least 12 characters.')).toBeVisible();expect(writes).toBe(0);
});

test('food, recipe and image actions explain invalid drafts without queuing writes',async({page,context})=>{
  await context.addCookies(session.cookies);await page.setViewportSize({width:390,height:900});await page.goto('/');
  let writes=0;page.on('request',request=>{if(request.url().endsWith('/api/sync')&&request.method()==='POST')writes++;});
  await food(page);await page.getByRole('button',{name:'Manual entry',exact:true}).click();
  await page.getByLabel('Food name',{exact:true}).fill('   ');await page.getByLabel('Calories (kcal)',{exact:true}).fill('');
  await page.getByRole('button',{name:'Save reviewed food'}).click();
  await expect(page.getByLabel('Food name',{exact:true})).toBeFocused();
  await expect(page.getByLabel('Calories (kcal)',{exact:true})).toHaveValue('');
  await expect(page.getByText('Enter calories (kcal).')).toBeVisible();expect(writes).toBe(0);
  await page.getByLabel('Food name',{exact:true}).fill('Zero calorie reviewed item');
  await page.getByLabel('Calories (kcal)',{exact:true}).fill('20001');await page.getByLabel('Meal',{exact:true}).focus();
  await expect(page.getByText('Enter 20000 or less.')).toBeVisible();
  await page.getByLabel('Calories (kcal)',{exact:true}).fill('0');await page.getByLabel('Protein (g)').fill('');
  await page.getByRole('button',{name:'Save reviewed food'}).click();
  await expect.poll(()=>writes).toBe(1);
  const state=await (await context.request.get('/api/state')).json();const entry=state.entries.find((item:{name:string})=>item.name==='Zero calorie reviewed item');
  expect(entry.calories).toBe(0);expect(entry.protein).toBeNull();
  await food(page);await page.getByRole('button',{name:'New recipe',exact:true}).click();await page.getByRole('button',{name:'Save recipe',exact:true}).click();
  await expect(page.getByText('Enter recipe name.')).toBeVisible();await expect(page.getByText('Add at least one ingredient.')).toBeVisible();expect(writes).toBe(1);
  await page.reload();await food(page);await page.getByRole('button',{name:'AI logging',exact:true}).click();
  await page.getByRole('button',{name:'Estimate my meal'}).click();await expect(page.getByText('Enter meal description and portions.')).toBeVisible();
  await page.getByLabel('How would you like to log?',{exact:true}).selectOption('label');await page.getByRole('button',{name:'Read nutrition label'}).click();
  await expect(page.getByText('Choose a photo before continuing.')).toBeVisible();
});

test('custom date controls receive first-invalid focus without opening their popover',async({page,context})=>{
  await context.addCookies(session.cookies);await page.goto('/');
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();await page.getByRole('dialog',{name:'Add',exact:true}).getByRole('button',{name:'Log weight',exact:true}).click();
  await page.getByLabel('Weigh-in date',{exact:true}).fill('');await page.getByRole('button',{name:'Save weigh-in'}).click();
  await expect(page.getByRole('button',{name:'Choose weigh-in date',exact:true})).toBeFocused();
  await expect(page.locator('.custom-calendar-popover')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Choose weigh-in date',exact:true})).toHaveAttribute('aria-invalid','true');
  for(const width of [390,768,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/validation-dialog-${width}-${theme}.png`,fullPage:true});
  }
});

test('coaching validates the active step and retains an empty macro draft',async({page,context})=>{
  await context.addCookies(session.cookies);await page.goto('/');await page.getByRole('button',{name:'Coach',exact:true}).click();
  let writes=0;page.on('request',request=>{if(request.url().endsWith('/api/sync')&&request.method()==='POST')writes++;});
  await page.getByLabel('Height (cm)',{exact:true}).fill('79');await page.getByRole('button',{name:/Next: Activity/}).click();
  await expect(page.getByText('Enter 80 or more.')).toBeVisible();await expect(page.getByLabel('Height (cm)',{exact:true})).toBeFocused();
  await page.getByLabel('Height (cm)',{exact:true}).fill('170');await page.getByRole('button',{name:/Next: Activity/}).click();
  await page.getByRole('button',{name:/Next: Goal/}).click();await page.getByRole('button',{name:/Next: Macros/}).click();
  await page.getByRole('button',{name:/Next: Adjust/}).click();
  await page.getByLabel('Protein percent',{exact:true}).fill('');
  await page.getByRole('button',{name:/Next: Distribution/}).click();
  await expect(page.getByLabel('Protein percent',{exact:true})).toHaveValue('');await expect(page.getByText('Enter protein percent.')).toBeVisible();expect(writes).toBe(0);
  await page.getByLabel('Protein percent',{exact:true}).fill('35');await expect(page.getByText('Enter protein percent.')).toHaveCount(0);
});

test('real decoding ignores barcodes outside the frame and stops every camera session',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.addInitScript(()=>{
    const state={streams:[] as MediaStream[],inside:false,deny:false,delay:false,release:undefined as undefined|(()=>void),draw:()=>{}};
    Object.assign(window,{barcodeTest:state});
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
      if(state.deny)throw new DOMException('Denied','NotAllowedError');
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
      const ctx=canvas.getContext('2d')!;
      // EAN-13 5901234123457, including its check digit and quiet zones.
      const left=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
      const right=left.map(value=>value.replace(/[01]/g,bit=>bit==='0'?'1':'0'));
      const even=right.map(value=>value.split('').reverse().join(''));
      const code='5901234123457';const parity='LGGLLG';
      const bits='101'+code.slice(1,7).split('').map((digit,i)=>(parity[i]==='L'?left:even)[Number(digit)]).join('')+'01010'+code.slice(7).split('').map(digit=>right[Number(digit)]).join('')+'101';
      state.draw=()=>{ctx.fillStyle='#fff';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#000';bits.split('').forEach((bit,i)=>{if(bit==='1')ctx.fillRect(497+i*3,state.inside?310:20,3,90);});};
      state.draw();const stream=canvas.captureStream(10);state.streams.push(stream);
      if(state.delay)await new Promise<void>(resolve=>{state.release=resolve;});
      return stream;
    }});
  });
  await page.goto('/');await food(page);await page.getByRole('button',{name:'Barcode',exact:true}).click();
  await page.getByRole('button',{name:'Scan barcode with camera'}).click();await expect(page.getByText('Place the barcode inside the frame.')).toBeVisible();
  await page.waitForTimeout(800);await expect(page.getByLabel('Barcode digits',{exact:true})).toHaveValue('');
  for(const width of [390,768,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await expect(page.locator('.barcode-frame')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/barcode-frame-${width}-${theme}.png`,fullPage:true});
  }
  await page.evaluate(()=>{const state=(window as any).barcodeTest;state.inside=true;state.draw();});
  await expect(page.getByLabel('Barcode digits',{exact:true})).toHaveValue('5901234123457');
  await expect(page.locator('video')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).barcodeTest.streams.every((stream:MediaStream)=>stream.getTracks().every(track=>track.readyState==='ended')))).toBe(true);
  await page.evaluate(()=>{(window as any).barcodeTest.inside=false;});
  await page.getByRole('button',{name:'Scan barcode with camera'}).click();await expect(page.getByText('Place the barcode inside the frame.')).toBeVisible();
  await page.getByRole('button',{name:'Search',exact:true}).first().click();
  await expect(page.locator('video')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).barcodeTest.streams.every((stream:MediaStream)=>stream.getTracks().every(track=>track.readyState==='ended')))).toBe(true);
  await page.getByRole('button',{name:'Barcode',exact:true}).click();
  await page.evaluate(()=>{(window as any).barcodeTest.delay=true;});await page.getByRole('button',{name:'Scan barcode with camera'}).click();
  await expect.poll(()=>page.evaluate(()=>!!(window as any).barcodeTest.release)).toBe(true);
  await page.getByRole('button',{name:'Stop camera',exact:true}).click();await page.evaluate(()=>{(window as any).barcodeTest.release();});
  await expect.poll(()=>page.evaluate(()=>(window as any).barcodeTest.streams.every((stream:MediaStream)=>stream.getTracks().every(track=>track.readyState==='ended')))).toBe(true);
  await page.evaluate(()=>{(window as any).barcodeTest.deny=true;});await page.getByRole('button',{name:'Scan barcode with camera'}).click();
  await expect(page.getByText('Allow camera access to scan, or enter the barcode digits.')).toBeVisible();
});

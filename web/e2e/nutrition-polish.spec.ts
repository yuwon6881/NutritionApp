import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {seedMobileUser,testOrigin,todayInTestZone} from './helpers/seed';

test.beforeEach(async({request,context})=>{
  const session=await seedMobileUser(request,'nutrition-polish',[]);
  await context.addCookies(session.cookies);
});

for(const width of [390,768,1440])for(const theme of ['light','dark']){
  test(`calendar, empty state and food actions at ${width}px in ${theme}`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:950});
    await page.addInitScript(value=>localStorage.setItem('nourish-theme',value),theme);
    await page.goto('/');
    await page.getByRole('button',{name:'Food Log',exact:true}).click();
    const calendar=page.getByRole('group',{name:'Choose a food day'});
    await expect(calendar).toBeVisible();
    await expect(calendar.locator('[aria-current="date"]')).toHaveAccessibleName(/today/);
    expect((await calendar.locator('[aria-current="date"]').boundingBox())!.height).toBe(60);
    await expect(page.getByRole('button',{name:'Previous food day'})).toHaveCount(0);
    await expect(page.locator('.diary-empty-state')).toContainText('No food entries for this day.');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width>=640){
      const before=await calendar.evaluate(element=>element.scrollLeft);
      await page.getByRole('button',{name:'Scroll calendar back one week'}).click();
      await expect.poll(()=>calendar.evaluate(element=>element.scrollLeft)).not.toBe(before);
      await expect(page.locator('.food-day-summary h2')).toHaveText('Today');
    }else await expect(page.getByRole('button',{name:'Scroll calendar back one week'})).toBeHidden();
    await page.screenshot({path:testInfo.outputPath('calendar.png'),fullPage:true});
    await page.getByRole('button',{name:'Log food',exact:true}).click();
    const methods=page.getByRole('group',{name:'Food logging method'});
    const widths=await methods.getByRole('button').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().width));
    expect(Math.max(...widths)-Math.min(...widths)).toBeLessThan(2);
    await methods.getByRole('button',{name:'Your foods',exact:true}).click();
    const actions=page.locator('.saved-foods-actions');
    for(const name of ['Custom food','New recipe']){
      const action=actions.getByRole('button',{name,exact:true});
      await expect(action).toBeVisible();
      expect(await action.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('saved-food-actions.png'),fullPage:true});
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Log food',exact:true})).toBeFocused();
  });
}

test('starring reuses a barcode mapping and appears in Saved before sync finishes',async({page,request})=>{
  const foodId=randomUUID();
  const saved={name:'My saved oats',source:'custom',calories:117,protein:10,carbs:5,fat:4,fiber:1,servingGrams:100,barcode:'12345678',favourite:false,ingredientsJson:'[]',portionsJson:'[]',cookedYieldGrams:null};
  expect((await request.post('/api/sync',{headers:{Origin:testOrigin,'X-Nutrition-Request':'1'},data:{id:randomUUID(),kind:'food',recordId:foodId,expectedRevision:0,delete:false,data:saved}})).ok()).toBe(true);
  await page.route('**/api/foods/search?**',route=>route.fulfill({json:[{...saved,name:'Provider oats',source:'provider',code:'12345678',basis:'per100g'}]}));
  let releaseSync:()=>void=()=>{};
  const hold=new Promise<void>(resolve=>{releaseSync=resolve;});
  const writes:{recordId:string;data:typeof saved}[]=[];
  await page.route('**/api/sync',async route=>{
    const body=route.request().postDataJSON();
    if(body.kind==='food'){writes.push(body);await hold;}
    await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  await page.getByLabel('Search term',{exact:true}).fill('oats');
  await page.getByRole('button',{name:'Save Provider oats to your foods',exact:true}).click();
  await page.getByRole('group',{name:'Food logging method'}).getByRole('button',{name:'Your foods',exact:true}).click();
  await expect(page.getByRole('button',{name:'Unfavourite My saved oats',exact:true})).toBeVisible();
  await expect.poll(()=>writes.length).toBe(1);
  expect(writes[0].recordId).toBe(foodId);
  expect(writes[0].data.calories).toBe(117);
  releaseSync();
  await expect.poll(async()=>{
    const response=await request.get('/api/foods');
    return (await response.json()).foods.find((food:{id:string})=>food.id===foodId)?.favourite;
  }).toBe(true);
  await page.reload();
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  await page.getByRole('group',{name:'Food logging method'}).getByRole('button',{name:'Your foods',exact:true}).click();
  await expect(page.getByRole('button',{name:'Unfavourite My saved oats',exact:true})).toBeVisible();
});

test('reminder toggle saves once and schedule edits save automatically',async({page})=>{
  const reminder={enabled:false,weekday:1,localTime:'09:00',timeZoneId:'Asia/Kuala_Lumpur'};
  const writes:typeof reminder[]=[];
  await page.route('**/api/notifications/status*',route=>route.fulfill({json:{...reminder,configured:true,thisDeviceSubscribed:true}}));
  await page.route('**/api/notifications/check-in-reminder',async route=>{
    if(route.request().method()==='POST'){
      Object.assign(reminder,route.request().postDataJSON());writes.push({...reminder});
    }
    await route.fulfill({json:reminder});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();
  await expect(page.getByLabel('Time zone',{exact:true})).toHaveCount(0);
  await expect(page.locator('.settings-account')).not.toContainText('Time zone');
  const toggle=page.getByRole('switch',{name:'Send a reminder on my check-in day'});
  await toggle.check();
  await expect.poll(()=>writes.length).toBe(1);
  await expect(page.getByText('Schedule saved automatically')).toBeVisible();
  await page.getByLabel('Day',{exact:true}).selectOption('2');
  await expect.poll(()=>writes.length).toBe(2);
  expect(writes[1].weekday).toBe(2);
  await expect(page.getByRole('button',{name:'Save reminder settings'})).toHaveCount(0);
  await toggle.uncheck();
  await expect.poll(()=>writes.length).toBe(3);
  expect(writes[2].enabled).toBe(false);
});

test('a late unloaded-library response does not erase an acknowledged favourite',async({page,request,context})=>{
  let releaseFirst:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{releaseFirst=resolve;});
  let fetched=false;
  let calls=0;
  await page.route('**/api/foods',async route=>{
    calls++;
    if(calls!==1){await route.continue();return;}
    const response=await route.fetch();
    fetched=true;
    await held;
    await route.fulfill({response});
  });
  await page.route('**/api/foods/search?**',route=>route.fulfill({json:[{name:'Fresh oats',source:'provider',calories:100,protein:5,carbs:10,fat:3,fiber:1,servingGrams:100,code:'87654321',basis:'per100g'}]}));
  await page.goto('/');
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await page.getByRole('button',{name:'Log food',exact:true}).click();
  await expect.poll(()=>fetched).toBe(true);
  await page.getByLabel('Search term',{exact:true}).fill('oats');
  await page.getByRole('button',{name:'Save Fresh oats to your foods',exact:true}).click();
  await page.getByRole('group',{name:'Food logging method'}).getByRole('button',{name:'Your foods',exact:true}).click();
  const star=page.getByRole('button',{name:'Unfavourite Fresh oats',exact:true});
  await expect(star).toBeVisible();
  await expect.poll(async()=>{
    const response=await request.get('/api/foods');
    return (await response.json()).foods.some((food:{name:string;favourite:boolean})=>food.name==='Fresh oats'&&food.favourite);
  }).toBe(true);
  releaseFirst();
  await expect(star).toBeVisible();
  await context.setOffline(true);
  await star.click();
  await expect(page.getByRole('button',{name:'Favourite Fresh oats',exact:true})).toBeVisible();
  await context.setOffline(false);
  await expect.poll(async()=>{
    const response=await request.get('/api/foods');
    return (await response.json()).foods.find((food:{name:string})=>food.name==='Fresh oats')?.favourite;
  }).toBe(false);
});

test('calendar labels reflect projected intake against its dated target',async({page,request})=>{
  const date=todayInTestZone();
  expect((await request.post('/api/sync',{headers:{Origin:testOrigin,'X-Nutrition-Request':'1'},data:{id:randomUUID(),kind:'entry',recordId:randomUUID(),expectedRevision:0,delete:false,data:{date,name:'Target meal',source:'manual',calories:625,protein:10,carbs:20,fat:5,fiber:1,quantity:100,unit:'g',time:'12:00'}}})).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  const today=page.locator('.food-week-strip [aria-current="date"]');
  await expect(today).toHaveAccessibleName(/625 of 2,500 kcal, 25% of target/);
  await expect(today.locator('.food-day-progress-fill')).toHaveAttribute('stroke-dasharray','25 100');
});

test('the combined reminder toggle requests permission and leaves the schedule off after denial',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(Notification,'permission',{configurable:true,get:()=> 'denied'});
    Notification.requestPermission=async()=> 'denied';
  });
  const reminder={enabled:false,weekday:1,localTime:'09:00',timeZoneId:'Asia/Kuala_Lumpur'};
  await page.route('**/api/notifications/status*',route=>route.fulfill({json:{...reminder,configured:true,thisDeviceSubscribed:false}}));
  let saved=0;
  await page.route('**/api/notifications/check-in-reminder',route=>{
    if(route.request().method()==='POST')saved++;
    return route.fulfill({json:reminder});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();
  const toggle=page.getByRole('switch',{name:'Send a reminder on my check-in day'});
  await toggle.click();
  await expect(page.getByText('Notifications are blocked. Allow them for this app in your device settings.')).toBeVisible();
  await expect(toggle).not.toBeChecked();
  expect(saved).toBe(0);
});

test('an existing account reminder has a spaced device warning',async({page},testInfo)=>{
  const reminder={enabled:true,weekday:1,localTime:'19:00',timeZoneId:'Asia/Kuala_Lumpur'};
  await page.route('**/api/notifications/status*',route=>route.fulfill({json:{...reminder,configured:true,thisDeviceSubscribed:false}}));
  await page.route('**/api/notifications/check-in-reminder',route=>route.fulfill({json:reminder}));
  await page.setViewportSize({width:390,height:950});
  await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();
  const warning=page.getByRole('alert').filter({hasText:'Reminders are not enabled here'});
  await expect(warning).toBeVisible();
  const before=(await page.locator('.notification-settings>.setting-row').boundingBox())!;
  const box=(await warning.boundingBox())!;
  expect(box.y-before.y-before.height).toBeGreaterThanOrEqual(15);
  await warning.scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('reminder-warning.png'),fullPage:true});
});

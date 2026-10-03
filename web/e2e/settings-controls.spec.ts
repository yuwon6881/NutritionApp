import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signIn} from './signIn';

async function openSettings(page:Page){
  await page.route('**/api/notifications/status*',route=>route.fulfill({json:{
    configured:true,thisDeviceSubscribed:true,reminderEnabled:true,weekday:1,localTime:'08:00',timeZoneId:'Asia/Kuala_Lumpur'
  }}));
  await page.route('**/api/notifications/check-in-reminder',route=>route.fulfill({json:{
    enabled:true,weekday:1,localTime:'08:00',timeZoneId:'Asia/Kuala_Lumpur'
  }}));
  await signIn(page);
  const state=await (await page.request.get('/api/state')).json();
  if(!state.profile){
    const response=await page.request.post('/api/sync',{
      headers:{Origin:new URL(page.url()).origin,'X-Nutrition-Request':'1'},
      data:{id:randomUUID(),kind:'profile',recordId:state.id,expectedRevision:0,delete:false,data:{
        dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0
      }}
    });
    expect(response.ok(),await response.text()).toBeTruthy();
    await page.reload();
  }
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();
}

for(const theme of ['light','dark'])test(`${theme} 1440: reminder day and time share a row and open the app time picker`,async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.addInitScript(value=>localStorage.setItem('nutrition-theme',value),theme);
  await openSettings(page);
  const day=page.locator('.notification-schedule-fields .field').first();
  const time=page.locator('.notification-schedule-fields .time-picker-field');
  await time.scrollIntoViewIfNeeded();
  const [dayBox,timeBox]=[(await day.boundingBox())!,(await time.boundingBox())!];
  expect(Math.abs(dayBox.y-timeBox.y)).toBeLessThan(2);
  expect(Math.abs(dayBox.width-timeBox.width)).toBeLessThan(2);

  // The whole field opens the picker, not only its clock icon.
  await time.locator('.custom-time-display').click();
  const picker=page.getByRole('dialog',{name:'Choose Time',exact:true});
  await expect(picker).toBeVisible();
  await page.screenshot({animations:'disabled',path:`artifacts/settings-controls/${theme}-1440-reminder.png`});
  await picker.getByRole('listbox',{name:'Hour'}).getByRole('button',{name:'09',exact:true}).click();
  await expect(page.locator('#nutrition-checkin-reminder-time')).toHaveValue('09:00');
});

test('390: reminder fields stack and stay inside the page',async({page})=>{
  await page.setViewportSize({width:390,height:900});
  await openSettings(page);
  const day=page.locator('.notification-schedule-fields .field').first();
  const time=page.locator('.notification-schedule-fields .time-picker-field');
  await time.scrollIntoViewIfNeeded();
  expect((await time.boundingBox())!.y).toBeGreaterThan((await day.boundingBox())!.y+20);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({animations:'disabled',path:'artifacts/settings-controls/390-reminder.png'});
});

test('1440: coaching setting controls share one width',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await openSettings(page);
  const basis=page.locator('#settings-weight-goal-metric');
  const checkIn=page.locator('.setting-row-control .field').filter({has:page.locator('#coaching-check-in-weekday')});
  await checkIn.scrollIntoViewIfNeeded();
  const [basisBox,checkInBox]=[(await basis.boundingBox())!,(await checkIn.boundingBox())!];
  expect(Math.abs(basisBox.width-checkInBox.width)).toBeLessThan(2);
  await page.screenshot({animations:'disabled',path:'artifacts/settings-controls/1440-coaching.png'});
});

import {test,expect} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';
import {mockBodyRecords} from './helpers/bodyRecords';
import {centerOf,swipe} from './helpers/touch';

let session:Awaited<ReturnType<typeof seedMobileUser>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,'body-swipe-user',[]);
});

test('a horizontal swipe on the photo moves between Body records; a vertical one scrolls',async({context,page})=>{
  await context.addCookies(session.cookies);
  await mockBodyRecords(page,null);
  await page.goto('/');
  await page.getByRole('button',{name:'Progress',exact:true}).first().click();
  await page.getByRole('button',{name:'Body',exact:true}).click();
  await page.getByRole('button',{name:'Open history',exact:true}).click();
  await page.getByRole('button',{name:/^Sep 26, 2026/}).click();
  const navigation=page.getByRole('navigation',{name:'Record navigation'});
  await expect(navigation).toContainText('Sep 26, 2026');

  const frame=page.locator('.body-photo-frame');
  const center=await centerOf(frame);
  await swipe(page,{x:center.x-120,y:center.y},{x:center.x+120,y:center.y});
  await expect(navigation).toContainText('Sep 5, 2026');
  await swipe(page,{x:center.x+120,y:center.y},{x:center.x-120,y:center.y});
  await expect(navigation).toContainText('Sep 26, 2026');
  await swipe(page,{x:center.x,y:center.y+120},{x:center.x+20,y:center.y-120});
  await expect(navigation).toContainText('Sep 26, 2026');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});

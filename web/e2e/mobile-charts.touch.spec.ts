import {test,expect} from '@playwright/test';
import {seedMobileUser,todayInTestZone} from './helpers/seed';

// Chart values must be readable on a touch screen, where hover tooltips never appear.
let session:Awaited<ReturnType<typeof seedMobileUser>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,'mobile-chart-user',[{name:'Overnight oats',time:'08:00',calories:410}]);
});

test('touching the weight chart reads the nearest date, and arrow keys step through dates',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.goto('/');
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  const readout=page.locator('.chart-readout').first();
  // The readout starts on the latest weigh-in instead of waiting for a hover.
  const readoutDate=readout.locator('time');
  await expect(readoutDate).toHaveAttribute('datetime',todayInTestZone());
  await expect(readout).toContainText('Trend');

  const chart=page.getByRole('img',{name:/weight chart across/});
  await chart.scrollIntoViewIfNeeded();
  const box=(await chart.boundingBox())!;
  await page.touchscreen.tap(box.x+60,box.y+box.height/2);
  await expect(readoutDate).not.toHaveAttribute('datetime',todayInTestZone());
  const firstDate=(await readoutDate.getAttribute('datetime'))!;

  const group=page.getByRole('group',{name:/Weight chart\. Touch the chart/});
  await group.focus();
  await page.keyboard.press('ArrowRight');
  await expect(readoutDate).not.toHaveAttribute('datetime',firstDate);
  await page.keyboard.press('End');
  await expect(readoutDate).toHaveAttribute('datetime',todayInTestZone());
});

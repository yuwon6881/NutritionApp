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
  // The Dashboard's weight card opens on the trend view; the other views stay in the page but inert.
  const card=page.locator('.weight-progress-card');
  await card.scrollIntoViewIfNeeded();
  const slide=card.locator('.swipe-carousel-slide:not([inert])');
  const readout=slide.locator('.chart-readout');
  // The readout starts on the latest weigh-in instead of waiting for a hover.
  const readoutDate=readout.locator('time');
  await expect(readoutDate).toHaveAttribute('datetime',todayInTestZone());
  await expect(readout).toContainText('Trend');

  const chart=slide.getByRole('img',{name:/weight chart across/});
  await chart.scrollIntoViewIfNeeded();
  // The plot scrolls inside the chart, so tap near the left edge of what is on screen.
  const box=(await slide.locator('.bar-chart-scroller').boundingBox())!;
  await page.touchscreen.tap(box.x+30,box.y+box.height/2);
  await expect(readoutDate).not.toHaveAttribute('datetime',todayInTestZone());
  const firstDate=(await readoutDate.getAttribute('datetime'))!;

  const group=slide.getByRole('group',{name:/Weight chart\. Touch the chart/});
  await group.focus();
  await page.keyboard.press('ArrowRight');
  await expect(readoutDate).not.toHaveAttribute('datetime',firstDate);
  await page.keyboard.press('End');
  await expect(readoutDate).toHaveAttribute('datetime',todayInTestZone());
});

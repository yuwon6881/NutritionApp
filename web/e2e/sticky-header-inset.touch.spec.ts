import {test,expect,type Page} from '@playwright/test';
import {signIn} from './signIn';

// Android edge-to-edge and installed PWAs report a status-bar inset; the sticky bar must never cover the heading.
async function headingClearsBar(page:Page){
  return await page.evaluate(()=>{
    const bar=document.querySelector('.topbar')!.getBoundingClientRect();
    const heading=document.querySelector('[data-page-heading]')!.getBoundingClientRect();
    return {barBottom:bar.bottom,headingTop:heading.top};
  });
}

test('page heading stays below the sticky bar with a status-bar inset',async({page})=>{
  await signIn(page,'test-alice');
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride' as never,{insets:{top:48,topMax:48}} as never);
  await page.goto('/');
  await expect(page.locator('[data-page-heading]')).toBeVisible();
  const resting=await headingClearsBar(page);
  expect(resting.headingTop).toBeGreaterThanOrEqual(resting.barBottom);

  await page.mouse.wheel(0,600);
  await page.mouse.wheel(0,-2000);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  const returned=await headingClearsBar(page);
  expect(returned.headingTop).toBeGreaterThanOrEqual(returned.barBottom);
});

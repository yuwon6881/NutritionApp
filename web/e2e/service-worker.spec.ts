import {expect,test} from '@playwright/test';

test('navigation reload after a worker update settles preload without console warnings',async({page,context})=>{
  const preloadWarnings:string[]=[];
  page.on('console',message=>{
    if(message.text().includes("The service worker navigation preload request was cancelled"))
      preloadWarnings.push(message.text());
  });
  const workerWarnings:string[]=[];
  context.on('console',message=>{
    if(/Event handler of .* event must be added on the initial evaluation|beforeinstallpromptevent\.preventDefault/.test(message.text()))workerWarnings.push(message.text());
  });

  await page.goto('/');
  await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready;
    await registration.update();
  });
  await page.reload();
  await page.waitForLoadState('networkidle');

  const preloadEnabled=await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready;
    return registration.navigationPreload ? (await registration.navigationPreload.getState()).enabled : false;
  });
  expect(preloadEnabled).toBe(false);
  expect(preloadWarnings).toEqual([]);
  expect(workerWarnings).toEqual([]);
});

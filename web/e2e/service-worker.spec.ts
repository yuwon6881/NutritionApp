import {expect,test} from '@playwright/test';
import {signIn} from './signIn';

test('Reload app navigates after a service-worker update',async({page})=>{
  await signIn(page);
  await page.evaluate(async()=>{
    if(!navigator.serviceWorker.controller){
      await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    }
    await navigator.serviceWorker.register(`/sw.js?update-test=${Date.now()}`,{scope:'/',type:'module'});
  });
  const reload=page.getByRole('button',{name:'Reload app',exact:true});
  await expect(reload).toBeVisible();
  await expect(reload).toBeEnabled();
  await Promise.all([page.waitForEvent('framenavigated',frame=>frame===page.mainFrame()),reload.click()]);
  await expect(reload).toBeHidden();
  await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{
    const registrations=await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(r=>r.unregister()));
  });
});

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
  await page.evaluate(async()=>{
    const registrations=await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(r=>r.unregister()));
  });
});

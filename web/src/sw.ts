/// <reference lib="webworker" />
import {DATABASE_VERSION,upgradeLocalDatabase} from './lib/localSchema';
import {savePwaIncomingImage,validateSharedImageBytes} from './lib/pwaIncomingImage';
import {parseNutritionReminderPayload} from './lib/push/pushPayload';
import {drainOutboxInServiceWorker} from './lib/swOutboxSync';
export {};
declare const self:ServiceWorkerGlobalScope&{__WB_MANIFEST:{url:string;revision:string|null}[]};
const manifest=self.__WB_MANIFEST;
const version=manifest.map(e=>e.url+e.revision).join('|');
const digest=[...version].reduce((n,c)=>Math.imul(n,31)+c.charCodeAt(0)|0,0).toString(16);
const cacheName='nutrition-app-assets-'+digest;
const assets=new Set(manifest.map(e=>new URL(e.url,self.location.origin).pathname));
const precacheUrls=[...new Set([...manifest.map(e=>e.url),'/'])];
// App Link (`/open`) redirects and asset links are answered by hosting, never by the cached shell.
const serverRoute=(url:URL)=>url.pathname.startsWith('/api/')||url.pathname.startsWith('/internal/')||url.pathname==='/health'
  ||url.pathname==='/open'||url.pathname.startsWith('/open/')||url.pathname.startsWith('/.well-known/');
const cacheable=(request:Request,url:URL)=>request.method==='GET'&&url.origin===self.location.origin&&!serverRoute(url);
function safeRoute(value:unknown):string{return value==='/coach'?'/coach':'/';}
self.addEventListener('push',(event:PushEvent)=>{
  event.waitUntil((async()=>{
    let payload:unknown;
    try{payload=event.data?.json();}catch{return;}
    const reminder=parseNutritionReminderPayload(payload,self.location.origin);
    if(!reminder)return;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:false});
    const foreground=windows.find(client=>(client as WindowClient).visibilityState==='visible');
    if(foreground){
      foreground.postMessage({type:'NUTRITION_FOREGROUND_REMINDER',payload});
      return;
    }
    await self.registration.showNotification('Nutrition check-in',{
      body:'Open Nutrition to review your check-in.',
      icon:'/icon-192.png',
      badge:'/badge-96.png',
      tag:'nutrition-check-in',
      data:{route:reminder.route}
    });
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')event.waitUntil(self.skipWaiting());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const route=event.notification.data?.route;
  let destination=new URL('/',self.location.origin);
  if(typeof route==='string')destination=new URL(safeRoute(route),self.location.origin);
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(new URL(client.url).origin!==self.location.origin)continue;
      const windowClient=client as WindowClient;
      windowClient.postMessage({type:'NUTRITION_REMINDER_OPEN',route:destination.pathname});
      await windowClient.focus();
      return;
    }
    await self.clients.openWindow(destination.href);
  })());
});
self.addEventListener('pushsubscriptionchange',event=>{
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows)client.postMessage({type:'REFRESH_PUSH_SUBSCRIPTION'});
  })());
});
self.addEventListener('sync',event=>{
  const syncEvent=event as ExtendableEvent&{tag?:string};
  if(syncEvent.tag==='nutrition-outbox')syncEvent.waitUntil(drainOutboxInServiceWorker(self.clients,self.location.origin));
});
self.addEventListener('install',event=>{
  // An update waits until its page can reload without interrupting open work.
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(precacheUrls)));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    // This worker already owns navigation responses, so a preload request has no
    // useful response path. Disable it for new workers; fetch handlers below still
    // settle any preload that was started while an older worker was active.
    if(self.registration.navigationPreload)await self.registration.navigationPreload.disable();
    // Other tabs can still be running the previous release while their editors are open.
    const previous=(await caches.keys()).filter(name=>name.startsWith('nutrition-app-assets-')&&name!==cacheName);
    for(const name of previous.slice(0,-1))await caches.delete(name);
    await self.clients.claim();
  })());
});
async function handleShareTarget(request:Request):Promise<Response>{
  try{
    const formData=await request.formData();
    const raw=formData.get('image');
    const candidate=raw instanceof File?raw:[...formData.values()].find((entry):entry is File=>entry instanceof File);
    if(!candidate)return Response.redirect('/?pwaShare=invalid',303);
    const buffer=await candidate.arrayBuffer();
    const checked=validateSharedImageBytes(buffer,candidate.name);
    if(!checked.ok)return Response.redirect(checked.reason==='too-large'?'/?pwaShare=too-large':'/?pwaShare=invalid',303);
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const openReq=indexedDB.open('nutrition-local',DATABASE_VERSION);
      openReq.onupgradeneeded=event=>upgradeLocalDatabase(openReq.result,event.oldVersion);
      openReq.onsuccess=()=>resolve(openReq.result);
      openReq.onerror=()=>reject(openReq.error??new Error('Failed to open local storage.'));
    });
    try{
      await savePwaIncomingImage(db,{bytes:checked.bytes,name:checked.name});
    }finally{
      db.close();
    }
    return Response.redirect('/?pwaShare=1',303);
  }catch{
    return Response.redirect('/?pwaShare=error',303);
  }
}

self.addEventListener('fetch',event=>{
  const request=event.request;const url=new URL(request.url);
  if(request.method==='POST'&&url.origin===self.location.origin&&url.pathname==='/share-target'){
    event.respondWith(handleShareTarget(request));
    return;
  }
  if(request.method!=='GET'||url.origin!==self.location.origin||serverRoute(url))return;
  if(assets.has(url.pathname)){
    event.respondWith((async()=>{const cache=await caches.open(cacheName);return await cache.match(url.pathname)||fetch(request);})());return;
  }
  if(request.mode==='navigate'&&!/\.[^/]+$/.test(url.pathname)){
    // A previous worker may have enabled navigation preload. Keep that promise
    // attached to the event even when the cached shell wins the race.
    event.waitUntil(event.preloadResponse.catch(()=>undefined));
    event.respondWith((async()=>{const cache=await caches.open(cacheName);const cached=await cache.match('/index.html')??await cache.match('/');return cached??fetch(request);})());
    return;
  }
  if(cacheable(request,url))event.respondWith((async()=>{
    const cache=await caches.open(cacheName);
    if(url.pathname.startsWith('/assets/')){
      const previous=(await caches.keys()).filter(name=>name.startsWith('nutrition-app-assets-')&&name!==cacheName);
      for(const name of previous){
        const saved=await caches.match(request,{cacheName:name});
        if(saved)return saved;
      }
    }
    try{
      const response=await fetch(request);
      const contentType=response.headers.get('Content-Type')??'';
      if(url.pathname.startsWith('/assets/')&&contentType.includes('text/html'))return new Response(null,{status:404});
      if(response.status===200&&!response.redirected)await cache.put(request,response.clone()).catch(()=>undefined);
      return response;
    }catch{
      return await cache.match(request)??new Response('Offline resource unavailable.',{status:503,statusText:'Offline'});
    }
  })());
});

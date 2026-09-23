/// <reference lib="webworker" />
import {getFirebaseConfig} from './lib/push/firebaseConfig';
import {parseNutritionReminderPayload} from './lib/push/pushPayload';
export {};
declare const self:ServiceWorkerGlobalScope&{__WB_MANIFEST:{url:string;revision:string|null}[]};
const manifest=self.__WB_MANIFEST;
const version=manifest.map(e=>e.url+e.revision).join('|');
const digest=[...version].reduce((n,c)=>Math.imul(n,31)+c.charCodeAt(0)|0,0).toString(16);
const cacheName='nutrition-app-assets-'+digest;
const legacyCachePrefix='nourish-assets-';
const assets=new Set(manifest.map(e=>new URL(e.url,self.location.origin).pathname));
const precacheUrls=[...new Set([...manifest.map(e=>e.url),'/'])];
const cacheable=(request:Request,url:URL)=>request.method==='GET'&&url.origin===self.location.origin&&!url.pathname.startsWith('/api/');
let firebaseBackgroundReady=false;
function safeRoute(value:unknown):string{
  if(typeof value!=='string')return '/';
  try{
    const candidate=new URL(value,self.location.origin);
    return candidate.origin===self.location.origin?candidate.pathname+candidate.search+candidate.hash:'/';
  }catch{return '/';}
}
self.addEventListener('push',(event:PushEvent)=>{
  // Firebase registers its handler asynchronously after feature detection. This
  // synchronous listener preserves a generic reminder if a cold-start push arrives
  // before that module finishes loading; once ready, Firebase owns delivery.
  if(firebaseBackgroundReady)return;
  event.waitUntil((async()=>{
    let payload:unknown;
    try{payload=event.data?.json();}catch{return;}
    const reminder=parseNutritionReminderPayload(payload,self.location.origin);
    if(!reminder)return;
    await self.registration.showNotification('Nutrition check-in',{
      body:'Open Nutrition to review your check-in.',
      icon:'/icon-192.png',
      badge:'/icon-192.png',
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
      if(windowClient.navigate)await windowClient.navigate(destination.href);
      await windowClient.focus();
      return;
    }
    await self.clients.openWindow(destination.href);
  })());
});
const firebaseConfig=getFirebaseConfig();
if(firebaseConfig){
  void (async()=>{
    try{
      const [{initializeApp},{getMessaging,onBackgroundMessage,isSupported}]=await Promise.all([
        import('firebase/app'),
        import('firebase/messaging/sw')
      ]);
      if(!await isSupported())return;
      const messaging=getMessaging(initializeApp(firebaseConfig));
      onBackgroundMessage(messaging,async payload=>{
        const route=typeof payload.data?.route==='string'?payload.data.route:'/';
        await self.registration.showNotification(payload.notification?.title??'Nutrition check-in',{
          body:payload.notification?.body??'Open Nutrition to review your check-in.',
          icon:'/icon-192.png',
          badge:'/icon-192.png',
          tag:'nutrition-check-in',
          data:{route}
        });
      });
      firebaseBackgroundReady=true;
    }catch{
      // Messaging is optional; unsupported browsers must keep the app worker operational.
    }
  })();
}
self.addEventListener('install',event=>{
  // A failed precache never activates a partially installed release. Once cached, activate immediately.
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(precacheUrls)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    // This worker already owns navigation responses, so a preload request has no
    // useful response path. Disable it for new workers; fetch handlers below still
    // settle any preload that was started while an older worker was active.
    if(self.registration.navigationPreload)await self.registration.navigationPreload.disable();
    for(const name of await caches.keys())if((name.startsWith('nutrition-app-assets-')||name.startsWith(legacyCachePrefix))&&name!==cacheName)await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request;const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/internal/'))return;
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
  if(cacheable(request,url))event.respondWith((async()=>{const cache=await caches.open(cacheName);try{const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}catch{return await cache.match(request)??new Response('Offline resource unavailable.',{status:503,statusText:'Offline'});}})());
});

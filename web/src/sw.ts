/// <reference lib="webworker" />
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
self.addEventListener('install',event=>{
  // A failed precache never activates a partially installed release. Updates wait for old clients.
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(precacheUrls)));
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

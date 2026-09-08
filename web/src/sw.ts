/// <reference lib="webworker" />
export {};
declare const self:ServiceWorkerGlobalScope&{__WB_MANIFEST:{url:string;revision:string|null}[]};
const manifest=self.__WB_MANIFEST;
const version=manifest.map(e=>e.url+e.revision).join('|');
const digest=[...version].reduce((n,c)=>Math.imul(n,31)+c.charCodeAt(0)|0,0).toString(16);
const cacheName='nourish-assets-'+digest;
const assets=new Set(manifest.map(e=>new URL(e.url,self.location.origin).pathname));
self.addEventListener('install',event=>{
  // A failed precache never activates a partially installed release. Updates wait for old clients.
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll([...new Set(manifest.map(e=>e.url))])));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('nourish-assets-')&&name!==cacheName)await caches.delete(name);await self.clients.claim();})());
});
self.addEventListener('fetch',event=>{
  const request=event.request;const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/internal/'))return;
  if(assets.has(url.pathname)){
    event.respondWith((async()=>{const cache=await caches.open(cacheName);return await cache.match(url.pathname)||fetch(request);})());return;
  }
  if(request.mode==='navigate'&&!/\.[^/]+$/.test(url.pathname)){
    event.respondWith((async()=>{try{return await fetch(request);}catch{return await (await caches.open(cacheName)).match('/index.html')??Response.error();}})());
  }
});

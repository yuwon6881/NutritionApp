/// <reference types="node" />
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {parseNutritionReminderPayload} from './push/pushPayload';

const source=readFileSync(new URL('../sw.ts',import.meta.url),'utf8').replace(/^import .*;$/m,'');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

function worker(){
  const fetchMock=vi.fn<(request:unknown)=>Promise<Response>>();
  const handlers=new Map<string,(event:unknown)=>void>();
  const showNotification=vi.fn().mockResolvedValue(undefined);
  const matchAll=vi.fn().mockResolvedValue([]);
  const openWindow=vi.fn().mockResolvedValue(undefined);
  const cache={match:vi.fn().mockResolvedValue(undefined),put:vi.fn().mockResolvedValue(undefined)};
  const caches={open:vi.fn().mockResolvedValue(cache)};
  // The worker scope owns fetch and Response; the vm sandbox does not inherit Node's globals.
  runInNewContext(compiled,{exports:{},URL,Response,fetch:fetchMock,parseNutritionReminderPayload,caches,self:{
    __WB_MANIFEST:[],location:{origin:'https://nutrition.test'},registration:{showNotification},
    clients:{matchAll,openWindow},addEventListener:(name:string,handler:(event:unknown)=>void)=>handlers.set(name,handler),
    caches
  }});
  const dispatch=async(name:string,properties:object)=>{
    let pending:Promise<unknown>|undefined;
    handlers.get(name)?.({...properties,waitUntil:(task:Promise<unknown>)=>{pending=task;}});
    await pending;
  };
  return {handlers,showNotification,matchAll,openWindow,dispatch,fetchMock,cache};
}

describe('service worker reminder lifecycle',()=>{
  it('registers all push handlers synchronously and handles a cold data-only push',async()=>{
    const instance=worker();
    for(const name of ['push','pushsubscriptionchange','notificationclick'])expect(instance.handlers.has(name)).toBe(true);
    await instance.dispatch('push',{data:{json:()=>({data:{kind:'check-in',route:'/coach'}})}});
    expect(instance.showNotification).toHaveBeenCalledOnce();
    expect(instance.showNotification).toHaveBeenCalledWith('Nutrition check-in',expect.objectContaining({body:'Open Nutrition to review your check-in.',tag:'nutrition-check-in',data:{route:'/coach'}}));
    await instance.dispatch('push',{data:{json:()=>({data:{kind:'check-in',route:'https://other.test'}})}});
    expect(instance.showNotification).toHaveBeenCalledOnce();
  });
  it('routes foreground delivery through one visible client without showing a second notification',async()=>{
    const instance=worker();
    const postMessage=vi.fn();
    instance.matchAll.mockResolvedValueOnce([{visibilityState:'visible',postMessage}]);
    const payload={data:{kind:'check-in',route:'/coach'}};
    await instance.dispatch('push',{data:{json:()=>payload}});
    expect(postMessage).toHaveBeenCalledWith({type:'NUTRITION_FOREGROUND_REMINDER',payload});
    expect(instance.showNotification).not.toHaveBeenCalled();
  });
  it('asks open clients to refresh a changed subscription',async()=>{
    const instance=worker();
    const postMessage=vi.fn();
    instance.matchAll.mockResolvedValueOnce([{postMessage}]);
    await instance.dispatch('pushsubscriptionchange',{});
    expect(postMessage).toHaveBeenCalledWith({type:'REFRESH_PUSH_SUBSCRIPTION'});
  });
  it('closes notifications and restricts click destinations to this app',async()=>{
    const instance=worker();
    const close=vi.fn();
    await instance.dispatch('notificationclick',{notification:{close,data:{route:'/coach'}}});
    expect(close).toHaveBeenCalledOnce();
    expect(instance.openWindow).toHaveBeenCalledWith('https://nutrition.test/coach');
    await instance.dispatch('notificationclick',{notification:{close,data:{route:'https://other.test'}}});
    expect(instance.openWindow).toHaveBeenLastCalledWith('https://nutrition.test/');
  });
  it('leaves server routes, App Link redirects and asset links to the network while intercepting assets',async()=>{
    const instance=worker();
    const fetchHandler=instance.handlers.get('fetch');
    expect(fetchHandler).toBeDefined();

    for(const path of ['/api/x','/internal/x','/health','/open','/open/coach','/.well-known/assetlinks.json']){
      const respondWith=vi.fn();
      fetchHandler!({
        request:{method:'GET',mode:'navigate',url:`https://nutrition.test${path}`},
        respondWith
      });
      expect(respondWith).not.toHaveBeenCalled();
    }

    instance.fetchMock.mockResolvedValue(new Response('icon'));
    const respondWith=vi.fn();
    fetchHandler!({
      request:{method:'GET',url:'https://nutrition.test/icon-192.png'},
      respondWith
    });
    expect(respondWith).toHaveBeenCalledOnce();
    await respondWith.mock.calls[0][0];
  });
  describe('same-origin resource fetches',()=>{
    const intercept=async(instance:ReturnType<typeof worker>)=>{
      const respondWith=vi.fn();
      instance.handlers.get('fetch')!({request:{method:'GET',url:'https://nutrition.test/icon-192.png'},respondWith});
      expect(respondWith).toHaveBeenCalledOnce();
      return await respondWith.mock.calls[0][0] as Response;
    };
    it('answers 503 when the network fails and nothing is cached',async()=>{
      const instance=worker();
      instance.fetchMock.mockRejectedValue(new TypeError('offline'));
      const response=await intercept(instance);
      expect(response.status).toBe(503);
      expect(response.statusText).toBe('Offline');
      expect(await response.text()).toBe('Offline resource unavailable.');
    });
    it('falls back to the cached copy when the network fails',async()=>{
      const instance=worker();
      const cached=new Response('cached');
      instance.cache.match.mockResolvedValue(cached);
      instance.fetchMock.mockRejectedValue(new TypeError('offline'));
      expect(await intercept(instance)).toBe(cached);
    });
    it('caches a successful response and returns it',async()=>{
      const instance=worker();
      const fresh=new Response('fresh');
      instance.fetchMock.mockResolvedValue(fresh);
      expect(await intercept(instance)).toBe(fresh);
      expect(instance.cache.put).toHaveBeenCalledOnce();
    });
  });
});

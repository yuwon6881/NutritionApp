/// <reference types="node" />
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {parseNutritionReminderPayload} from './push/pushPayload';

const source=readFileSync(new URL('../sw.ts',import.meta.url),'utf8').replace(/^import .*;$/m,'');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

function worker(){
  const handlers=new Map<string,(event:unknown)=>void>();
  const showNotification=vi.fn().mockResolvedValue(undefined);
  const matchAll=vi.fn().mockResolvedValue([]);
  const openWindow=vi.fn().mockResolvedValue(undefined);
  runInNewContext(compiled,{exports:{},URL,parseNutritionReminderPayload,self:{
    __WB_MANIFEST:[],location:{origin:'https://nutrition.test'},registration:{showNotification},
    clients:{matchAll,openWindow},addEventListener:(name:string,handler:(event:unknown)=>void)=>handlers.set(name,handler)
  }});
  const dispatch=async(name:string,properties:object)=>{
    let pending:Promise<unknown>|undefined;
    handlers.get(name)?.({...properties,waitUntil:(task:Promise<unknown>)=>{pending=task;}});
    await pending;
  };
  return {handlers,showNotification,matchAll,openWindow,dispatch};
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
});

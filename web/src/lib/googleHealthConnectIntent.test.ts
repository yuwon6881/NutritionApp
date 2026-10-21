import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {captureConnectIntent,connectIntentUrl,hasConnectIntent,takeConnectIntent} from './googleHealthConnectIntent';

function memoryStorage():Storage{
  const values=new Map<string,string>();
  return {get length(){return values.size;},clear:()=>values.clear(),getItem:key=>values.get(key)??null,key:index=>[...values.keys()][index]??null,
    removeItem:key=>{values.delete(key);},setItem:(key,value)=>{values.set(key,String(value));}};
}

// A minimal browser: an address bar that history.replaceState rewrites, and per-tab storage.
function stubBrowser(path:string){
  const location=new URL(path,'https://nutrition.example');
  vi.stubGlobal('sessionStorage',memoryStorage());
  vi.stubGlobal('window',{
    get location(){return location;},
    history:{state:null,replaceState:(_state:unknown,_title:string,next:string)=>{const url=new URL(next,location);location.search=url.search;location.pathname=url.pathname;}},
  });
}

beforeEach(()=>stubBrowser('/'));
afterEach(()=>vi.unstubAllGlobals());

describe('Google Health connect intent',()=>{
  it('carries the reviewed choice to the browser Settings page',()=>{
    expect(connectIntentUrl('https://nutrition.example',{syncWeight:true,syncNutrition:true,syncBodyFat:true,importWeight:false}))
      .toBe('https://nutrition.example/settings?google_health_connect=sync');
    expect(connectIntentUrl('https://nutrition.example',{}))
      .toBe('https://nutrition.example/settings?google_health_connect=none');
  });

  it('survives a sign-in round trip once and leaves the address bar clean',()=>{
    stubBrowser('/settings?google_health_connect=sync,import');
    captureConnectIntent(1000);
    expect((window.location as unknown as URL).search).toBe('');
    expect(hasConnectIntent(2000)).toBe(true);
    expect(takeConnectIntent(2000)).toEqual({syncWeight:true,syncNutrition:true,syncBodyFat:true,importWeight:true});
    expect(takeConnectIntent(2000)).toBeNull();
  });

  it('expires a stale intent',()=>{
    stubBrowser('/settings?google_health_connect=none');
    captureConnectIntent(0);
    expect(takeConnectIntent(11*60*1000)).toBeNull();
  });
});

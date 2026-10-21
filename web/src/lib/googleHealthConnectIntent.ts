import type {ConnectOptions} from './googleHealth';

// The Android app reviews the disclosure, then hands consent to the browser. The browser carries that
// choice through a possible Fitness Account sign-in (which returns to `/`) so consent starts without
// asking a second time. The intent is per tab and short-lived; it never holds a session or OAuth URL.
export const GOOGLE_HEALTH_CONNECT_PARAM='google_health_connect';
const STORAGE_KEY='nutrition-google-health-connect-intent';
const LIFETIME_MS=10*60*1000;

interface StoredIntent {options:ConnectOptions;at:number}

export function connectIntentUrl(origin:string,options:ConnectOptions):string{
  const url=new URL('/settings',origin);
  const parts=[options.syncWeight?'sync':'',options.importWeight?'import':''].filter(Boolean);
  url.searchParams.set(GOOGLE_HEALTH_CONNECT_PARAM,parts.length?parts.join(','):'none');
  return url.href;
}

function parseOptions(value:string):ConnectOptions{
  const parts=new Set(value.split(','));
  const sync=parts.has('sync');
  return {syncWeight:sync,syncNutrition:sync,syncBodyFat:sync,importWeight:parts.has('import')};
}

function storage():Storage|null{
  try{return typeof sessionStorage==='undefined'?null:sessionStorage;}catch{return null;}
}

/** Moves a handoff parameter out of the address bar into tab storage; call once at startup. */
export function captureConnectIntent(now=Date.now()):void{
  if(typeof window==='undefined')return;
  const url=new URL(window.location.href);
  const value=url.searchParams.get(GOOGLE_HEALTH_CONNECT_PARAM);
  if(value===null)return;
  try{storage()?.setItem(STORAGE_KEY,JSON.stringify({options:parseOptions(value),at:now} satisfies StoredIntent));}catch{/* Without storage the person connects from Settings by hand. */}
  url.searchParams.delete(GOOGLE_HEALTH_CONNECT_PARAM);
  window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
}

function read(now:number):StoredIntent|null{
  try{
    const raw=storage()?.getItem(STORAGE_KEY);
    if(!raw)return null;
    const intent=JSON.parse(raw) as StoredIntent;
    if(typeof intent?.at!=='number'||now-intent.at>LIFETIME_MS||now<intent.at){storage()?.removeItem(STORAGE_KEY);return null;}
    return intent;
  }catch{return null;}
}

export function hasConnectIntent(now=Date.now()):boolean{
  return read(now)!==null;
}

/** Returns the pending choice once; later calls see nothing. */
export function takeConnectIntent(now=Date.now()):ConnectOptions|null{
  const intent=read(now);
  try{storage()?.removeItem(STORAGE_KEY);}catch{/* Already unreadable. */}
  return intent?.options??null;
}

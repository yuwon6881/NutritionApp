import {App} from '@capacitor/app';

/**
 * Verified Android App Links claim only `/open/…`. Sign-in and Google Health consent run in the
 * browser and return to `/` and `/settings`; claiming those would pull the redirect into the app
 * and strand the browser session. Hosting redirects each `/open/…` link to its page for browsers.
 */
export const APP_LINK_ROUTES:Readonly<Record<string,string>>={'/open':'/','/open/coach':'/coach','/open/settings':'/settings'};

export function appLinkRoute(raw:unknown,origin:string):string|null{
  if(typeof raw!=='string')return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.host!==new URL(origin).host)return null;
    const path=url.pathname.length>1?url.pathname.replace(/\/$/,''):url.pathname;
    return Object.hasOwn(APP_LINK_ROUTES,path)?APP_LINK_ROUTES[path]:null;
  }catch{return null;}
}

/** Capacitor retains the launch link until this listener attaches, so cold starts arrive here too. */
export async function listenForAppLinks(callback:(route:string)=>void){
  const listener=await App.addListener('appUrlOpen',({url})=>{
    const route=appLinkRoute(url,window.location.origin);
    if(route)callback(route);
  });
  return()=>{void listener.remove();};
}

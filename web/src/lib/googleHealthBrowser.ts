import {Capacitor} from '@capacitor/core';

let handoffPending=false;

export function consumeGoogleHealthHandoff():boolean{
  const pending=handoffPending;
  handoffPending=false;
  return pending;
}

export function googleHealthRequiresBrowser(){
  return Capacitor.isNativePlatform();
}

export async function openGoogleHealthSettingsInBrowser():Promise<boolean>{
  if(!googleHealthRequiresBrowser())return false;
  const {Browser}=await import('@capacitor/browser');
  // OAuth callback validation binds to its browser session; never transfer the WebView cookie.
  handoffPending=true;
  try{
    await Browser.open({url:new URL('/settings',window.location.origin).href});
  }catch(error){handoffPending=false;throw error;}
  return true;
}

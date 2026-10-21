import {Capacitor} from '@capacitor/core';
import type {ConnectOptions} from './googleHealth';
import {connectIntentUrl} from './googleHealthConnectIntent';

let handoffPending=false;

export function consumeGoogleHealthHandoff():boolean{
  const pending=handoffPending;
  handoffPending=false;
  return pending;
}

export function googleHealthRequiresBrowser(){
  return Capacitor.isNativePlatform();
}

export async function openGoogleHealthSettingsInBrowser(options?:ConnectOptions):Promise<boolean>{
  if(!googleHealthRequiresBrowser())return false;
  const {Browser}=await import('@capacitor/browser');
  // OAuth callback validation binds to its browser session; never transfer the WebView cookie.
  handoffPending=true;
  try{
    // The reviewed choice travels with the link so the browser goes straight on to Google consent.
    await Browser.open({url:options?connectIntentUrl(window.location.origin,options):new URL('/settings',window.location.origin).href});
  }catch(error){handoffPending=false;throw error;}
  return true;
}

import {Capacitor} from '@capacitor/core';

const DEFAULT_REGISTRATION_TIMEOUT_MS=10_000;
const DEFAULT_READY_TIMEOUT_MS=8_000;

let registrationPromise:Promise<ServiceWorkerRegistration|null>|undefined;

function withTimeout<T>(promise:Promise<T>,timeoutMs:number,message:string):Promise<T>{
  return new Promise((resolve,reject)=>{
    const timer=window.setTimeout(()=>reject(new Error(message)),timeoutMs);
    promise.then(value=>{
      window.clearTimeout(timer);
      resolve(value);
    },error=>{
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

export function registerAppServiceWorker(timeoutMs=DEFAULT_REGISTRATION_TIMEOUT_MS):Promise<ServiceWorkerRegistration|null>{
  // The Android package carries its own app shell; its WebView cache must not shadow APK updates.
  if(Capacitor.isNativePlatform())return Promise.resolve(null);
  if(!('serviceWorker' in navigator))return Promise.resolve(null);
  if(registrationPromise)return registrationPromise;

  const script=import.meta.env.DEV?'/dev-sw.js?dev-sw':'/sw.js';
  registrationPromise=new Promise<ServiceWorkerRegistration>((resolve,reject)=>{
    let settled=false;
    const finish=(registration?:ServiceWorkerRegistration,error?:unknown)=>{
      if(settled)return;
      settled=true;
      window.clearTimeout(timer);
      window.removeEventListener('load',register);
      if(error!==undefined)reject(error);
      else resolve(registration!);
    };
    const register=()=>{
      try{
        void navigator.serviceWorker.register(script,{scope:'/',type:'module'}).then(
          registration=>finish(registration),
          error=>finish(undefined,error)
        );
      }catch(error){finish(undefined,error);}
    };
    const timer=window.setTimeout(()=>finish(undefined,new Error('App service worker registration is taking too long.')),timeoutMs);
    if(document.readyState==='complete')register();
    else window.addEventListener('load',register,{once:true});
  }).catch(error=>{
    registrationPromise=undefined;
    const detail=error instanceof Error?error.message:'unknown error';
    throw new Error(`Offline features could not start: ${detail}`);
  });
  return registrationPromise;
}

export function retryAppServiceWorkerRegistration(timeoutMs=DEFAULT_REGISTRATION_TIMEOUT_MS){
  registrationPromise=undefined;
  return registerAppServiceWorker(timeoutMs);
}

export async function waitForAppServiceWorker(timeoutMs=DEFAULT_READY_TIMEOUT_MS):Promise<ServiceWorkerRegistration>{
  if(!('serviceWorker' in navigator))throw new Error('This browser does not support the app service worker.');
  const deadline=Date.now()+timeoutMs;
  const remaining=()=>Math.max(1,deadline-Date.now());
  const timeoutMessage='App notifications are taking too long to set up.';
  try{
    const registration=await withTimeout(registerAppServiceWorker(remaining()),remaining(),timeoutMessage);
    if(!registration)throw new Error('This browser does not support the app service worker.');
    return await withTimeout(navigator.serviceWorker.ready,remaining(),timeoutMessage);
  }catch(error){
    if(error instanceof Error&&(
      error.message===timeoutMessage||
      error.message==='This browser does not support the app service worker.'||
      error.message.startsWith('Offline features could not start:')
    ))throw error;
    throw new Error('App notifications could not access the service worker. Try again or reload the app.');
  }
}

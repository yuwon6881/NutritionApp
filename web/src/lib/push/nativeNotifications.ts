import {Capacitor,type PermissionState,type PluginListenerHandle} from '@capacitor/core';
import type {ActionPerformed} from '@capacitor/push-notifications';

export const NUTRITION_PUSH_CHANNEL_ID='nutrition-reminders';

export function isNativeAndroid(){
  return Capacitor.getPlatform()==='android';
}

export function isNativePushConfigured(){
  return isNativeAndroid();
}

type PushNotificationsPlugin=typeof import('@capacitor/push-notifications').PushNotifications;

// A Capacitor plugin proxy answers every property, `then` included, so a promise resolved with the
// plugin itself would wait forever on a native "then". Hand it over wrapped instead.
async function getPushNotifications():Promise<{plugin:PushNotificationsPlugin}>{
  if(!isNativeAndroid()){
    throw new Error('Native Android notifications are unavailable in this app.');
  }
  const {PushNotifications}=await import('@capacitor/push-notifications');
  return {plugin:PushNotifications};
}

export async function checkNativeNotificationPermission():Promise<PermissionState>{
  const {plugin}=await getPushNotifications();
  return (await plugin.checkPermissions()).receive;
}

export async function requestNativeNotificationPermission():Promise<PermissionState>{
  const {plugin}=await ensureChannel();
  return (await plugin.requestPermissions()).receive;
}

async function ensureChannel(){
  const push=await getPushNotifications();
  await push.plugin.createChannel({
    id:NUTRITION_PUSH_CHANNEL_ID,
    name:'Nutrition reminders',
    description:'Weekly coaching check-in reminders',
    importance:4,
    visibility:1,
    sound:'default',
    vibration:true
  });
  return push;
}

export async function registerNativePushAndGetToken(timeoutMs=20000):Promise<string>{
  const {plugin:PushNotifications}=await ensureChannel();
  return new Promise((resolve,reject)=>{
    let settled=false;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    let registrationListener:PluginListenerHandle|undefined;
    let errorListener:PluginListenerHandle|undefined;

    const cleanup=()=>{
      if(timeout)clearTimeout(timeout);
      void registrationListener?.remove();
      void errorListener?.remove();
    };

    const finish=(error?:Error,token?:string)=>{
      if(settled)return;
      settled=true;
      cleanup();
      if(error)reject(error);
      else if(token)resolve(token);
      else reject(new Error('Firebase did not return a device registration.'));
    };

    void (async()=>{
      try{
        const registrationHandle=await PushNotifications.addListener('registration',registration=>
          finish(undefined,registration.value));
        // Android may deliver a retained token before addListener returns its handle.
        if(settled){void registrationHandle.remove();return;}
        registrationListener=registrationHandle;
        const errorHandle=await PushNotifications.addListener('registrationError',error=>
          finish(new Error(error.error||'Native push registration failed.')));
        if(settled){void errorHandle.remove();return;}
        errorListener=errorHandle;
        timeout=setTimeout(()=>finish(new Error('Native push registration timed out. Try again.')),timeoutMs);
        await PushNotifications.register();
      }catch(error){
        finish(error instanceof Error?error:new Error('Native push registration failed.'));
      }
    })();
  });
}

export async function unregisterNativePush(){
  const {plugin}=await getPushNotifications();
  await plugin.unregister();
}

export async function listenForNativePushActions(callback:(data:unknown)=>void){
  const {plugin}=await getPushNotifications();
  const listener=await plugin.addListener(
    'pushNotificationActionPerformed',
    (action:ActionPerformed)=>callback(action.notification.data)
  );
  return()=>{void listener.remove();};
}

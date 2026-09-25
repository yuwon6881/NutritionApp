import {Capacitor,type PermissionState,type PluginListenerHandle} from '@capacitor/core';
import type {ActionPerformed} from '@capacitor/push-notifications';

export const NUTRITION_PUSH_CHANNEL_ID='nutrition-reminders';

export function isNativeAndroid(){
  return Capacitor.getPlatform()==='android';
}

export function isNativePushConfigured(){
  return isNativeAndroid();
}

async function getPushNotifications(){
  if(!isNativeAndroid()){
    throw new Error('Native Android notifications are unavailable in this app.');
  }
  const {PushNotifications}=await import('@capacitor/push-notifications');
  return PushNotifications;
}

export async function checkNativeNotificationPermission():Promise<PermissionState>{
  const PushNotifications=await getPushNotifications();
  return (await PushNotifications.checkPermissions()).receive;
}

export async function requestNativeNotificationPermission():Promise<PermissionState>{
  const PushNotifications=await ensureChannel();
  return (await PushNotifications.requestPermissions()).receive;
}

async function ensureChannel(){
  const PushNotifications=await getPushNotifications();
  await PushNotifications.createChannel({
    id:NUTRITION_PUSH_CHANNEL_ID,
    name:'Nutrition reminders',
    description:'Weekly coaching check-in reminders',
    importance:4,
    visibility:1,
    sound:'default',
    vibration:true
  });
  return PushNotifications;
}

export async function registerNativePushAndGetToken(timeoutMs=20000):Promise<string>{
  const PushNotifications=await ensureChannel();
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
        registrationListener=await PushNotifications.addListener('registration',registration=>
          finish(undefined,registration.value));
        errorListener=await PushNotifications.addListener('registrationError',error=>
          finish(new Error(error.error||'Native push registration failed.')));
        timeout=setTimeout(()=>finish(new Error('Native push registration timed out. Try again.')),timeoutMs);
        await PushNotifications.register();
      }catch(error){
        finish(error instanceof Error?error:new Error('Native push registration failed.'));
      }
    })();
  });
}

export async function unregisterNativePush(){
  const PushNotifications=await getPushNotifications();
  await PushNotifications.unregister();
}

export async function listenForNativePushActions(callback:(data:unknown)=>void){
  const PushNotifications=await getPushNotifications();
  const listener=await PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action:ActionPerformed)=>callback(action.notification.data)
  );
  return()=>{void listener.remove();};
}

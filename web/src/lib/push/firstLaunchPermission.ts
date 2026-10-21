import {checkNativeNotificationPermission,isNativeAndroid,requestNativeNotificationPermission} from './nativeNotifications';

export const NOTIFICATION_PROMPT_KEY='nutrition-notification-prompted';
// Android drops a permission request made while the activity is still starting (splash), so wait
// until the page is visible and has settled.
const SETTLE_MS=1500;

function whenVisibleAndSettled():Promise<void>{
  return new Promise(resolve=>{
    const settle=()=>window.setTimeout(resolve,SETTLE_MS);
    if(document.visibilityState==='visible'){settle();return;}
    const onVisible=()=>{
      if(document.visibilityState!=='visible')return;
      document.removeEventListener('visibilitychange',onVisible);
      settle();
    };
    document.addEventListener('visibilitychange',onVisible);
  });
}

function alreadyAsked(){
  try{return Boolean(localStorage.getItem(NOTIFICATION_PROMPT_KEY));}catch{return true;}
}

/**
 * Asks once, on the first launch of the installed Android app, for the notification permission
 * Android 13+ requires. It only grants permission: subscribing a device to reminders stays an explicit
 * Settings choice. The attempt is recorded only once Android returns a decision, so a request the
 * system dropped is retried on the next launch; a refusal is final and Settings links to Android
 * settings instead.
 */
export async function promptNotificationsOnFirstLaunch(settled:()=>Promise<void>=whenVisibleAndSettled):Promise<void>{
  if(!isNativeAndroid()||alreadyAsked())return;
  try{
    await settled();
    let state=await checkNativeNotificationPermission();
    if(state==='prompt'||state==='prompt-with-rationale')state=await requestNativeNotificationPermission();
    if(state!=='prompt')localStorage.setItem(NOTIFICATION_PROMPT_KEY,new Date().toISOString());
  }catch{
    // The permission is optional at launch; Settings rechecks it and offers the request again.
  }
}

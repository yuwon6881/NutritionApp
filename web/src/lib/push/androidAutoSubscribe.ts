import {registerNotificationDevice} from '../notifications';
import {savePushDeviceCredential} from '../local';
import {checkNativeNotificationPermission,registerNativePushAndGetToken} from './nativeNotifications';
import {hasDevicePushOptOut} from './deviceOptOut';

/**
 * Allowing the Android notification permission is the only step the person takes: once it is granted,
 * the device registers itself. A device the person turned off keeps that choice, and a device without
 * the permission stays unsubscribed. Reminders still send only when the weekly reminder is enabled.
 */
export async function subscribeAllowedAndroidDevice(userId:string,deviceId:string):Promise<void>{
  if(hasDevicePushOptOut(userId,deviceId))return;
  if(await checkNativeNotificationPermission()!=='granted')return;
  const token=await registerNativePushAndGetToken();
  await savePushDeviceCredential(userId,deviceId,token);
  await registerNotificationDevice(deviceId,token,'android');
  window.dispatchEvent(new Event('nutrition-push-enabled'));
}

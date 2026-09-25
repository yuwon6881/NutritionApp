import {fetchNotificationStatus,registerNotificationDevice,type NotificationPlatform} from '../notifications';
import {
  deletePushDeviceCredential,
  readPushDeviceCredential,
  savePushDeviceCredential,
  savePushRevocation
} from '../local';
import {deleteFcmToken,getFcmToken} from './firebaseMessaging';
import {isFirebasePushConfigured} from './firebaseConfig';
import {
  checkNativeNotificationPermission,
  isNativeAndroid,
  registerNativePushAndGetToken,
  unregisterNativePush
} from './nativeNotifications';
import {retryPendingPushRevocations} from './revocations';
import {waitForAppServiceWorker} from '../registerAppServiceWorker';

export async function reconcileNotificationDevice(userId:string,deviceId:string):Promise<void>{
  const status=await fetchNotificationStatus(deviceId);
  if(!status.configured||!status.thisDeviceSubscribed)return;

  const platform:NotificationPlatform=isNativeAndroid()?'android':'web';
  const permission=platform==='android'
    ?await checkNativeNotificationPermission()
    :typeof Notification==='undefined'?'unsupported':Notification.permission;

  if(permission!=='granted'){
    const credential=await readPushDeviceCredential(userId,deviceId);
    if(credential){
      await savePushRevocation(userId,deviceId,credential.fcmToken);
      await retryPendingPushRevocations(userId);
      await deletePushDeviceCredential(userId,deviceId,credential.fcmToken);
    }
    return;
  }

  let token:string|null=null;
  if(platform==='android'){
    token=await registerNativePushAndGetToken();
  }else if(isFirebasePushConfigured()){
    const registration=await waitForAppServiceWorker();
    token=await getFcmToken(registration);
  }
  if(!token)return;

  await savePushDeviceCredential(userId,deviceId,token);
  await registerNotificationDevice(deviceId,token,platform);
}

export async function disableLocalPushForPlatform():Promise<void>{
  if(isNativeAndroid()){
    await unregisterNativePush();
    return;
  }
  if(typeof navigator==='undefined'||!('serviceWorker' in navigator)||!isFirebasePushConfigured())return;

  const registration=await waitForAppServiceWorker();
  await deleteFcmToken(registration);
}

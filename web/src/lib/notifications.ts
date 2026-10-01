import {api,type ApiFetchOptions} from './api';

export interface CheckInReminder {
  enabled:boolean;
  weekday:number;
  localTime:string;
  timeZoneId:string;
}

export interface NotificationStatus extends CheckInReminder {
  configured:boolean;
  thisDeviceSubscribed:boolean;
}

export type NotificationPlatform='web'|'android';

const statusReads = new Map<string, Promise<NotificationStatus>>();
export function fetchNotificationStatus(deviceId:string,accountId:string){
  const key = JSON.stringify([accountId,deviceId]);
  const existing = statusReads.get(key);
  if (existing) return existing;
  const read = api<NotificationStatus>(`/notifications/status?deviceId=${encodeURIComponent(deviceId)}`,undefined,'GET')
    .finally(() => {if (statusReads.get(key) === read) statusReads.delete(key);});
  statusReads.set(key,read);
  return read;
}

export function fetchCheckInReminder(){
  return api<CheckInReminder>('/notifications/check-in-reminder',undefined,'GET');
}

export function saveCheckInReminder(reminder:CheckInReminder){
  return api<CheckInReminder>('/notifications/check-in-reminder',reminder,'POST');
}

/** Device consent must succeed before enabling the account reminder. */
export async function activateCheckInReminder(reminder:CheckInReminder,subscribe:()=>Promise<void>){
  await subscribe();
  try{return await saveCheckInReminder({...reminder,enabled:true});}
  catch(error){
    throw new Error(`This device is subscribed, but the reminder could not be saved. ${error instanceof Error?error.message:'Try saving again.'}`);
  }
}

export function registerNotificationDevice(deviceId:string,fcmToken:string,platform:NotificationPlatform='web'){
  statusReads.clear();
  return api<void>('/notifications/subscriptions',{deviceId,fcmToken,platform},'POST').finally(() => statusReads.clear());
}

export function removeNotificationDevice(deviceId:string,fcmToken:string,options?:ApiFetchOptions){
  statusReads.clear();
  return api<void>(`/notifications/subscriptions/${encodeURIComponent(deviceId)}`,{fcmToken},'DELETE',options).finally(() => statusReads.clear());
}

export function revokePushDeviceSubscription(userId:string,deviceId:string,fcmToken:string,options?:ApiFetchOptions){
  return api<void>('/notifications/subscriptions/revoke',{userId,deviceId,fcmToken},'POST',options);
}

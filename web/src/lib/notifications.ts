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

export function fetchNotificationStatus(deviceId:string){
  return api<NotificationStatus>(`/notifications/status?deviceId=${encodeURIComponent(deviceId)}`,undefined,'GET');
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
  return api<void>('/notifications/subscriptions',{deviceId,fcmToken,platform},'POST');
}

export function removeNotificationDevice(deviceId:string,fcmToken:string,options?:ApiFetchOptions){
  return api<void>(`/notifications/subscriptions/${encodeURIComponent(deviceId)}`,{fcmToken},'DELETE',options);
}

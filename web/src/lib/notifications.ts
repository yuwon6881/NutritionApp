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

export function fetchNotificationStatus(deviceId:string){
  return api<NotificationStatus>(`/notifications/status?deviceId=${encodeURIComponent(deviceId)}`,undefined,'GET');
}

export function fetchCheckInReminder(){
  return api<CheckInReminder>('/notifications/check-in-reminder',undefined,'GET');
}

export function saveCheckInReminder(reminder:CheckInReminder){
  return api<CheckInReminder>('/notifications/check-in-reminder',reminder,'POST');
}

export function registerNotificationDevice(deviceId:string,fcmToken:string){
  return api<void>('/notifications/subscriptions',{deviceId,fcmToken},'POST');
}

export function removeNotificationDevice(deviceId:string,fcmToken:string,options?:ApiFetchOptions){
  return api<void>(`/notifications/subscriptions/${encodeURIComponent(deviceId)}`,{fcmToken},'DELETE',options);
}

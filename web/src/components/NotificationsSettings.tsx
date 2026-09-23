import {useEffect,useState} from 'react';
import {Bell,BellOff} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {CheckInReminder,NotificationStatus} from '../lib/notifications';
import {fetchCheckInReminder,fetchNotificationStatus,registerNotificationDevice,saveCheckInReminder} from '../lib/notifications';
import {getOrCreatePushDeviceId} from '../lib/push/deviceId';
import {getFcmToken} from '../lib/push/firebaseMessaging';
import {deletePushDeviceCredential,readPushDeviceCredential,readPushRevocations,savePushDeviceCredential,savePushRevocation} from '../lib/local';
import {retryPendingPushRevocations} from '../lib/push/revocations';
import {waitForAppServiceWorker} from '../lib/registerAppServiceWorker';
import {isFirebasePushConfigured} from '../lib/push/firebaseConfig';
import {Button} from './ui/Button';
import {Checkbox} from './ui/Checkbox';
import {Field,SelectField} from './ui/Field';
import {CardFeedback} from './ui/CardFeedback';
import {useMobilePwa} from './ui/MobilePwa';
import {isNativeApp} from '../lib/nativeApp';

const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function iosDevice(){
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)||(/MacIntel/i.test(navigator.platform??'')&&navigator.maxTouchPoints>1);
}

function validTimeZone(value:string){
  try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return true;}
  catch{return false;}
}

function deviceSupportError(installed:boolean,status?:NotificationStatus){
  if(isNativeApp())return 'Native push notifications are not enabled in this Android build. Use the browser app to receive reminder notifications.';
  if(status?.configured===false)return 'Push notifications are not configured for this Nutrition deployment yet.';
  if(!isFirebasePushConfigured())return 'Push notifications are not configured for this app build yet.';
  if(typeof Notification==='undefined'||!('PushManager' in window)||!('serviceWorker' in navigator))return 'This browser does not support web push notifications.';
  if(iosDevice()&&!installed)return 'On iPhone and iPad, install Nutrition on the Home Screen before turning on notifications.';
  return '';
}

export function NotificationsSettings({store}:{store:Nourish}){
  const pwa=useMobilePwa();
  const [deviceId]=useState(getOrCreatePushDeviceId);
  const [status,setStatus]=useState<NotificationStatus>();
  const [savedReminder,setSavedReminder]=useState<CheckInReminder|null>(null);
  const [reminder,setReminder]=useState<CheckInReminder>(()=>({
    enabled:false,
    weekday:store.state!.settings?.checkInWeekday??1,
    localTime:'09:00',
    timeZoneId:store.state!.profile?.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'
  }));
  const [permission,setPermission]=useState(()=>typeof Notification==='undefined'?'unsupported':Notification.permission);
  const [loading,setLoading]=useState(true);
  const [scheduleLoaded,setScheduleLoaded]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [loadError,setLoadError]=useState('');

  useEffect(()=>{
    let current=true;
    setLoading(true);
    void Promise.allSettled([fetchNotificationStatus(deviceId),fetchCheckInReminder()]).then(results=>{
      if(!current)return;
      const [deviceResult,reminderResult]=results;
      if(deviceResult.status==='fulfilled')setStatus(deviceResult.value);
      else setLoadError((deviceResult.reason as Error).message||'Notification status is unavailable.');
      if(reminderResult.status==='fulfilled'){
        setReminder(reminderResult.value);
        setSavedReminder(reminderResult.value);
        setScheduleLoaded(true);
      }else setLoadError(previous=>previous||((reminderResult.reason as Error).message||'Reminder settings are unavailable.'));
    }).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[deviceId]);

  useEffect(()=>{
    const refreshPermission=()=>{
      setPermission(typeof Notification==='undefined'?'unsupported':Notification.permission);
      void fetchNotificationStatus(deviceId).then(setStatus).catch(()=>{});
    };
    window.addEventListener('focus',refreshPermission);
    window.addEventListener('online',refreshPermission);
    window.addEventListener('nourish-push-revocation-drained',refreshPermission);
    return()=>{
      window.removeEventListener('focus',refreshPermission);
      window.removeEventListener('online',refreshPermission);
      window.removeEventListener('nourish-push-revocation-drained',refreshPermission);
    };
  },[deviceId]);

  const supportError=deviceSupportError(pwa.installed,status);
  const canManageSchedule=status?.configured===true;

  const enableThisDevice=async()=>{
    setError('');setMessage('');setBusy(true);
    try{
      if(typeof Notification==='undefined')throw new Error('Notifications are unavailable in this browser.');
      const granted=Notification.permission==='granted'||await Notification.requestPermission()==='granted';
      setPermission(Notification.permission);
      if(!granted)throw new Error(Notification.permission==='denied'
        ?'Notifications are blocked. Allow them for this app in your browser or iPhone/iPad settings.'
        :'Notification permission was not granted.');
      const registration=await waitForAppServiceWorker();
      const token=await getFcmToken(registration);
      if(!token)throw new Error('This app build does not have a push registration key.');
      await savePushDeviceCredential(store.state!.id,deviceId,token);
      await registerNotificationDevice(deviceId,token);
      setStatus(current=>current?{...current,thisDeviceSubscribed:true}:current);
      window.dispatchEvent(new Event('nourish-push-enabled'));
      setMessage('Notifications are enabled on this device. Lock-screen text is kept general.');
    }catch(ex){setError((ex as Error).message||'Could not enable notifications on this device.');}
    finally{setBusy(false);}
  };

  const disableThisDevice=async()=>{
    setError('');setMessage('');setBusy(true);
    try{
      const credential=await readPushDeviceCredential(store.state!.id,deviceId);
      if(!credential)throw new Error('The saved notification token is unavailable. Enable notifications again on this device before turning them off.');
      await savePushRevocation(store.state!.id,deviceId,credential.fcmToken);
      try{await retryPendingPushRevocations(store.state!.id);}
      catch{/* Keep the durable request and report its retry state below. */}
      const remaining=await readPushRevocations();
      if(remaining.some(item=>item.userId===store.state!.id&&item.deviceId===deviceId&&item.fcmToken===credential.fcmToken))
        throw new Error('The turn-off request is saved on this device and will retry when you reconnect as this account.');
      await deletePushDeviceCredential(store.state!.id,deviceId,credential.fcmToken);
      setStatus(current=>current?{...current,thisDeviceSubscribed:false}:current);
      window.dispatchEvent(new Event('nourish-push-disabled'));
      setMessage('Notifications are turned off on this device. The account reminder schedule is unchanged.');
    }catch(ex){setError((ex as Error).message||'Could not turn off notifications on this device.');}
    finally{setBusy(false);}
  };

  const saveReminder=async()=>{
    setError('');setMessage('');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.localTime)){
      setError('Choose a valid reminder time.');return;
    }
    if(!validTimeZone(reminder.timeZoneId)){
      setError('Enter a valid time zone such as Asia/Kuala_Lumpur.');return;
    }
    setBusy(true);
    try{
      const saved=await saveCheckInReminder(reminder);
      setReminder(saved);
      setSavedReminder(saved);
      setStatus(current=>current?{...current,...saved}:current);
      setMessage(saved.enabled?'Weekly coaching reminder saved.':'Weekly coaching reminder turned off.');
    }catch(ex){setError((ex as Error).message||'Could not save the reminder.');}
    finally{setBusy(false);}
  };

  const reminderDirty=scheduleLoaded&&savedReminder!==null&&(
    reminder.enabled!==savedReminder.enabled||reminder.weekday!==savedReminder.weekday||
    reminder.localTime!==savedReminder.localTime||reminder.timeZoneId!==savedReminder.timeZoneId
  );

  return <section className="panel notification-settings" aria-labelledby="notifications-title" data-pwa-dirty={reminderDirty?'true':undefined}>
    <h2 id="notifications-title">Notifications</h2>
    <p className="source">Optional weekly coaching reminders. Notifications use general text and never include food, weight, or account details.</p>
    {loading&&<p role="status" aria-busy="true">Checking notification availability…</p>}
    {loadError&&<CardFeedback tone="warning" title="Notification settings unavailable" message={loadError}/>}
    {!loading&&supportError&&<CardFeedback tone="info" message={supportError}/>}
    {!loading&&status?.configured&&isFirebasePushConfigured()&&<>
      <p className="source notification-permission">Browser permission: <strong>{permission==='granted'?'Allowed':permission==='denied'?'Blocked':permission==='default'?'Not requested':'Unavailable'}</strong></p>
      {status.thisDeviceSubscribed
        ?<div className="actions notification-device-actions"><span className="source"><Bell size={16} aria-hidden="true"/> This device can receive reminders.</span><Button variant="secondary" disabled={busy} onClick={()=>void disableThisDevice()}><BellOff size={16}/>Turn off on this device</Button></div>
        :<div className="actions notification-device-actions"><Button disabled={busy||!!supportError} onClick={()=>void enableThisDevice()}><Bell size={16}/>{busy?'Updating…':'Enable notifications on this device'}</Button></div>}
      {reminder.enabled&&!status.thisDeviceSubscribed&&<p className="notice" role="status">The account reminder is on, but this device is not subscribed. Enable device notifications to receive it here.</p>}
      <h3 className="notification-reminder-heading">Weekly coaching reminder</h3>
      {!scheduleLoaded&&<p role="status">Loading reminder settings…</p>}
      {scheduleLoaded&&<>
        <Checkbox id="nutrition-checkin-reminder-enabled" checked={reminder.enabled} disabled={busy||!canManageSchedule} onChange={enabled=>setReminder(current=>({...current,enabled}))} role="switch">Send a reminder on my check-in day</Checkbox>
        <div className="form-grid notification-schedule-fields">
          <SelectField id="nutrition-checkin-reminder-weekday" name="weekday" label="Day" value={String(reminder.weekday)} disabled={busy||!canManageSchedule} onChange={value=>setReminder(current=>({...current,weekday:Number(value)}))}>
            {weekdays.map((day,index)=><option key={day} value={index}>{day}</option>)}
          </SelectField>
          <Field id="nutrition-checkin-reminder-time" name="localTime" type="time" step={60} label="Time" value={reminder.localTime} disabled={busy||!canManageSchedule} onChange={event=>setReminder(current=>({...current,localTime:event.target.value}))}/>
          <Field id="nutrition-checkin-reminder-zone" name="timeZoneId" type="text" label="Time zone" value={reminder.timeZoneId} disabled={busy||!canManageSchedule} onChange={event=>setReminder(current=>({...current,timeZoneId:event.target.value}))} validate={()=>reminder.timeZoneId&&!validTimeZone(reminder.timeZoneId)?'Enter a valid IANA time zone.':undefined} hint="Use an IANA time zone, for example Asia/Kuala_Lumpur."/>
        </div>
        <div className="actions notification-save-actions"><Button disabled={busy||!canManageSchedule} onClick={()=>void saveReminder()}>{busy?'Saving…':'Save reminder settings'}</Button></div>
      </>}
    </>}
    {error&&<CardFeedback title="Notification action failed" message={error}/>}
    {message&&<CardFeedback tone="success" message={message}/>}
  </section>;
}

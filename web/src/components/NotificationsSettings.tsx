import {useEffect,useState} from 'react';
import {Bell,BellOff} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {CheckInReminder,NotificationStatus} from '../lib/notifications';
import {fetchCheckInReminder,fetchNotificationStatus,registerNotificationDevice,saveCheckInReminder} from '../lib/notifications';
import type {NotificationPlatform} from '../lib/notifications';
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
import {SettingRow} from './ui/SettingRow';
import {checkNativeNotificationPermission,isNativeAndroid,isNativePushConfigured,registerNativePushAndGetToken,requestNativeNotificationPermission} from '../lib/push/nativeNotifications';
import {disableLocalPushForPlatform} from '../lib/push/deviceLifecycle';

const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function iosDevice(){
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)||(/MacIntel/i.test(navigator.platform??'')&&navigator.maxTouchPoints>1);
}

function validTimeZone(value:string){
  try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return true;}
  catch{return false;}
}

function deviceSupportError(installed:boolean,status?:NotificationStatus,nativeConfigured=false){
  if(status?.configured===false)return 'Push notifications are not configured for this Nutrition deployment yet.';
  if(isNativeAndroid())return nativeConfigured?'':'Firebase push is not configured in this Android build yet.';
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
  const [permission,setPermission]=useState(()=>isNativeAndroid()?'prompt':typeof Notification==='undefined'?'unsupported':Notification.permission);
  const [nativePushConfigured,setNativePushConfigured]=useState(false);
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
      if(isNativeAndroid())void checkNativeNotificationPermission().then(setPermission).catch(()=>setPermission('unsupported'));
      else setPermission(typeof Notification==='undefined'?'unsupported':Notification.permission);
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

  useEffect(()=>{
    if(!isNativeAndroid())return;
    let current=true;
    void Promise.all([isNativePushConfigured(),checkNativeNotificationPermission()]).then(([configured,permission])=>{
      if(!current)return;
      setNativePushConfigured(configured);
      setPermission(permission);
    }).catch(()=>{
      if(current)setNativePushConfigured(false);
    });
    return()=>{current=false;};
  },[]);

  const supportError=deviceSupportError(pwa.installed,status,nativePushConfigured);
  const canManageSchedule=status?.configured===true;
  const pushBuildConfigured=isNativeAndroid()?nativePushConfigured:isFirebasePushConfigured();

  const enableThisDevice=async()=>{
    setError('');setMessage('');setBusy(true);
    try{
      const native=isNativeAndroid();
      let granted=false;
      let permissionValue='';
      if(native){
        if(!nativePushConfigured)throw new Error('Firebase push is not configured in this Android build yet.');
        const current=await checkNativeNotificationPermission();
        const next=current==='granted'?current:await requestNativeNotificationPermission();
        setPermission(next);
        permissionValue=next;
        granted=next==='granted';
      }else{
        if(typeof Notification==='undefined')throw new Error('Notifications are unavailable in this browser.');
        granted=Notification.permission==='granted'||await Notification.requestPermission()==='granted';
        setPermission(Notification.permission);
        permissionValue=Notification.permission;
      }
      if(!granted)throw new Error(permissionValue==='denied'||permissionValue==='prompt-with-rationale'
        ?'Notifications are blocked. Allow them for this app in your device settings.'
        :'Notification permission was not granted.');
      const token=native?await registerNativePushAndGetToken():await getFcmToken(await waitForAppServiceWorker());
      if(!token)throw new Error('This app build does not have a push registration key.');
      await savePushDeviceCredential(store.state!.id,deviceId,token);
      const platform:NotificationPlatform=native?'android':'web';
      await registerNotificationDevice(deviceId,token,platform);
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
      let localUnregisterError:Error|undefined;
      try{await disableLocalPushForPlatform();}
      catch(ex){localUnregisterError=ex instanceof Error?ex:new Error('The device could not unregister from push notifications.');}
      try{await retryPendingPushRevocations(store.state!.id);}
      catch{/* Keep the durable request and report its retry state below. */}
      const remaining=await readPushRevocations();
      if(remaining.some(item=>item.userId===store.state!.id&&item.deviceId===deviceId&&item.fcmToken===credential.fcmToken))
        throw new Error('The turn-off request is saved on this device and will retry when you reconnect as this account.');
      await deletePushDeviceCredential(store.state!.id,deviceId,credential.fcmToken);
      setStatus(current=>current?{...current,thisDeviceSubscribed:false}:current);
      window.dispatchEvent(new Event('nourish-push-disabled'));
      if(localUnregisterError)throw new Error(`The server subscription was removed, but this device could not unregister locally: ${localUnregisterError.message}`);
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

  const permissionLabel=permission==='granted'?'Allowed':permission==='denied'?'Blocked':permission==='default'||permission==='prompt'?'Not requested':'Unavailable';
  const fieldsDisabled=busy||!canManageSchedule;

  return <div className="notification-settings" data-pwa-dirty={reminderDirty?'true':undefined}>
    {loading&&<p className="settings-loading" role="status" aria-busy="true">Checking notification availability…</p>}
    {loadError&&<CardFeedback tone="warning" title="Notification settings unavailable" message={loadError}/>}
    {!loading&&supportError&&<CardFeedback tone="info" message={supportError}/>}
    {!loading&&status?.configured&&<>
      {pushBuildConfigured&&<SettingRow label="This device"
        description={<>
          <span className="notification-permission">{isNativeAndroid()?'App permission':'Browser permission'}: <strong>{permissionLabel}</strong></span>
          {status.thisDeviceSubscribed&&<span className="setting-row-status is-positive"><Bell size={14} aria-hidden="true"/>This device can receive reminders.</span>}
        </>}>
        {status.thisDeviceSubscribed
          ?<Button variant="secondary" disabled={busy} onClick={()=>void disableThisDevice()}><BellOff size={16} aria-hidden="true"/>Turn off on this device</Button>
          :<Button disabled={busy||!!supportError} onClick={()=>void enableThisDevice()}><Bell size={16} aria-hidden="true"/>{busy?'Updating…':'Enable notifications on this device'}</Button>}
      </SettingRow>}
      {pushBuildConfigured&&reminder.enabled&&!status.thisDeviceSubscribed&&<p className="notice settings-inline-notice" role="status">The account reminder is on, but this device is not subscribed. Enable device notifications to receive it here.</p>}
      {!scheduleLoaded&&<p className="settings-loading" role="status">Loading reminder settings…</p>}
      {scheduleLoaded&&<div className="setting-row-group">
        <SettingRow label={<h3 className="setting-row-heading">Weekly coaching reminder</h3>} description="Sent on your check-in day to every device with notifications turned on.">
          <Checkbox id="nutrition-checkin-reminder-enabled" role="switch" aria-label="Send a reminder on my check-in day" checked={reminder.enabled} disabled={fieldsDisabled} onChange={enabled=>setReminder(current=>({...current,enabled}))}/>
        </SettingRow>
        <div className="form-grid notification-schedule-fields">
          <SelectField id="nutrition-checkin-reminder-weekday" name="weekday" label="Day" value={String(reminder.weekday)} disabled={fieldsDisabled} onChange={value=>setReminder(current=>({...current,weekday:Number(value)}))}>
            {weekdays.map((day,index)=><option key={day} value={index}>{day}</option>)}
          </SelectField>
          <Field id="nutrition-checkin-reminder-time" name="localTime" type="time" step={60} label="Time" value={reminder.localTime} disabled={fieldsDisabled} onChange={event=>setReminder(current=>({...current,localTime:event.target.value}))}/>
          <Field id="nutrition-checkin-reminder-zone" name="timeZoneId" type="text" label="Time zone" value={reminder.timeZoneId} disabled={fieldsDisabled} onChange={event=>setReminder(current=>({...current,timeZoneId:event.target.value}))} validate={()=>reminder.timeZoneId&&!validTimeZone(reminder.timeZoneId)?'Enter a valid IANA time zone.':undefined} hint="Use an IANA time zone, for example Asia/Kuala_Lumpur."/>
        </div>
        <div className="actions notification-save-actions">
          {reminderDirty&&<span className="setting-row-status">Unsaved changes</span>}
          <Button variant={reminderDirty?'primary':'secondary'} disabled={fieldsDisabled||!reminderDirty} onClick={()=>void saveReminder()}>{busy?'Saving…':'Save reminder settings'}</Button>
        </div>
      </div>}
    </>}
    {error&&<CardFeedback title="Notification action failed" message={error}/>}
    {message&&<CardFeedback tone="success" message={message}/>}
  </div>;
}

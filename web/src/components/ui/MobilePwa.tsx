import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {App} from '@capacitor/app';
import {RefreshCw} from 'lucide-react';
import {isFirebasePushConfigured} from '../../lib/push/firebaseConfig';
import {onForegroundMessage} from '../../lib/push/firebaseMessaging';
import {getPwaUpdateNoticeState,hasUncommittedPwaWork} from '../../lib/pwaUpdate';
import {registerAppServiceWorker,waitForAppServiceWorker} from '../../lib/registerAppServiceWorker';
import {isNativeApp} from '../../lib/nativeApp';
import {getOrCreatePushDeviceId} from '../../lib/push/deviceId';
import {reconcileNotificationDevice} from '../../lib/push/deviceLifecycle';
import {listenForNativePushActions,isNativeAndroid} from '../../lib/push/nativeNotifications';
import {parseNutritionReminderPayload} from '../../lib/push/pushPayload';
import {Button} from './Button';

interface InstallPromptEvent extends Event {
  prompt:()=>Promise<void>;
  userChoice:Promise<{outcome:'accepted'|'dismissed';platform:string}>;
}

interface StorageSnapshot {
  supported:boolean;
  persistent:boolean|null;
  used?:number;
  quota?:number;
}

interface MobilePwaContextValue {
  installed:boolean;
  installAvailable:boolean;
  install:()=>Promise<void>;
  online:boolean;
  waiting:boolean;
  editorOpen:boolean;
  reloadPending:boolean;
  applyUpdate:()=>void;
  reloadApp:()=>void;
  storage:StorageSnapshot;
  refreshStorage:()=>Promise<void>;
  requestPersistentStorage:()=>Promise<boolean>;
  storageBusy:boolean;
  storageMessage:string;
  serviceWorkerStatus:'checking'|'ready'|'failed'|'unsupported'|'native';
  serviceWorkerError:string;
  retryServiceWorker:()=>void;
  appVersion:string;
}

const MobilePwaContext=createContext<MobilePwaContextValue|null>(null);

function standaloneMode(){
  return isNativeApp()||window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || (navigator as Navigator&{standalone?:boolean}).standalone===true;
}

async function readStorage():Promise<StorageSnapshot>{
  const manager=navigator.storage;
  if(!manager||typeof manager.estimate!=='function')return {supported:false,persistent:null};
  const [estimate,persistent]=await Promise.all([
    manager.estimate().catch(()=>undefined),
    typeof manager.persisted==='function'?manager.persisted().catch(()=>null):Promise.resolve(null)
  ]);
  return {supported:true,persistent,used:estimate?.usage,quota:estimate?.quota};
}

export function MobilePwaProvider({children}:{children:ReactNode}){
  const [installPrompt,setInstallPrompt]=useState<InstallPromptEvent|null>(null);
  const [installed,setInstalled]=useState(()=>standaloneMode());
  const [online,setOnline]=useState(()=>navigator.onLine);
  const [waitingWorker,setWaitingWorker]=useState<ServiceWorker|null>(null);
  const [editorOpen,setEditorOpen]=useState(false);
  const [reloadPending,setReloadPending]=useState(false);
  const [storage,setStorage]=useState<StorageSnapshot>({supported:false,persistent:null});
  const [storageBusy,setStorageBusy]=useState(false);
  const [storageMessage,setStorageMessage]=useState('');
  const [serviceWorkerStatus,setServiceWorkerStatus]=useState<MobilePwaContextValue['serviceWorkerStatus']>(()=>isNativeApp()?'native':'checking');
  const [serviceWorkerError,setServiceWorkerError]=useState('');
  const [serviceWorkerRetry,setServiceWorkerRetry]=useState(0);
  const watchedRegistrations=useRef(new WeakSet<ServiceWorkerRegistration>());
  const initialController=useRef(false);

  const refreshStorage=async()=>{
    try{setStorage(await readStorage());}
    catch{setStorage({supported:!!navigator.storage,persistent:null});}
  };

  useEffect(()=>{
    initialController.current=!!navigator.serviceWorker?.controller;
    const onInstallPrompt=(event:Event)=>{
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled=()=>{setInstalled(true);setInstallPrompt(null);};
    const onOnline=()=>setOnline(true);
    const onOffline=()=>setOnline(false);
    const displayMode=window.matchMedia('(display-mode: standalone)');
    const updateInstalled=()=>setInstalled(standaloneMode());
    const updateEditorOpen=()=>setEditorOpen(hasUncommittedPwaWork(
      !!document.querySelector('dialog[open]'),!!document.querySelector('[data-pwa-dirty="true"]')
    ));
    const observer=new MutationObserver(updateEditorOpen);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','data-pwa-dirty']});

    const onControllerChange=()=>{
      if(initialController.current)setReloadPending(true);
      else initialController.current=true;
    };
    const watchRegistration=(registration:ServiceWorkerRegistration)=>{
      if(watchedRegistrations.current.has(registration))return;
      watchedRegistrations.current.add(registration);
      const activate=(worker:ServiceWorker|null|undefined)=>{
        if(!worker)return;
        setWaitingWorker(worker);
        worker.postMessage({type:'SKIP_WAITING'});
      };
      const inspect=()=>{
        if(registration.waiting)activate(registration.waiting);
      };
      const onUpdateFound=()=>{
        const worker=registration.installing;
        if(!worker)return;
        worker.addEventListener('statechange',()=>{
          if(worker.state==='installed'&&navigator.serviceWorker.controller)activate(registration.waiting??worker);
        });
      };
      inspect();
      registration.addEventListener('updatefound',onUpdateFound);
    };

    window.addEventListener('beforeinstallprompt',onInstallPrompt);
    window.addEventListener('appinstalled',onInstalled);
    window.addEventListener('online',onOnline);
    window.addEventListener('offline',onOffline);
    displayMode.addEventListener('change',updateInstalled);
    navigator.serviceWorker?.addEventListener('controllerchange',onControllerChange);
    void refreshStorage();
    setServiceWorkerError('');
    if(isNativeApp())setServiceWorkerStatus('native');
    else if(!('serviceWorker' in navigator))setServiceWorkerStatus('unsupported');
    else{
      setServiceWorkerStatus('checking');
      void registerAppServiceWorker().then(registration=>{
        if(!registration){setServiceWorkerStatus('unsupported');return;}
        watchRegistration(registration);
        setServiceWorkerStatus('ready');
      }).catch(error=>{
        setServiceWorkerError(error instanceof Error?error.message:'Service worker registration failed.');
        setServiceWorkerStatus('failed');
      });
    }
    updateEditorOpen();

    return()=>{
      observer.disconnect();
      window.removeEventListener('beforeinstallprompt',onInstallPrompt);
      window.removeEventListener('appinstalled',onInstalled);
      window.removeEventListener('online',onOnline);
      window.removeEventListener('offline',onOffline);
      displayMode.removeEventListener('change',updateInstalled);
      navigator.serviceWorker?.removeEventListener('controllerchange',onControllerChange);
    };
  },[serviceWorkerRetry]);

  const install=async()=>{
    if(!installPrompt)return;
    const prompt=installPrompt;
    setInstallPrompt(null);
    try{
      await prompt.prompt();
      await prompt.userChoice;
    }catch{/* Browser install UI can be dismissed or unavailable without affecting app use. */}
  };

  const retryServiceWorker=()=>setServiceWorkerRetry(value=>value+1);

  const requestPersistentStorage=async()=>{
    const manager=navigator.storage;
    if(!manager||typeof manager.persist!=='function'){
      setStorageMessage('This browser does not offer persistent storage for this app.');
      return false;
    }
    setStorageBusy(true);
    setStorageMessage('');
    try{
      const granted=await manager.persist();
      await refreshStorage();
      setStorageMessage(granted
        ?'The browser will prioritize keeping this app’s local data on this device.'
        :'The browser manages storage retention for this app and did not grant persistent storage.');
      return granted;
    }catch{
      setStorageMessage('The browser could not update storage retention. Your synced account data remains available online.');
      return false;
    }finally{setStorageBusy(false);}
  };

  const applyUpdate=()=>waitingWorker?.postMessage({type:'SKIP_WAITING'});
  const reloadApp=()=>{
    if(hasUncommittedPwaWork(!!document.querySelector('dialog[open]'),!!document.querySelector('[data-pwa-dirty="true"]')))return;
    window.location.reload();
  };
  const value:MobilePwaContextValue={
    installed,installAvailable:!!installPrompt,install,online,waiting:!!waitingWorker,editorOpen,reloadPending,applyUpdate,reloadApp,
    storage,refreshStorage,requestPersistentStorage,storageBusy,storageMessage,
    serviceWorkerStatus,serviceWorkerError,retryServiceWorker,appVersion:__APP_VERSION__
  };
  return <MobilePwaContext.Provider value={value}>{children}</MobilePwaContext.Provider>;
}

export function useMobilePwa(){
  const value=useContext(MobilePwaContext);
  if(!value)throw new Error('MobilePwaProvider is missing.');
  return value;
}

export function PwaUpdateNotice(){
  const pwa=useMobilePwa();
  const state=getPwaUpdateNoticeState(pwa.reloadPending,pwa.editorOpen);
  if(state.kind==='none')return null;
  return <div className="notice pwa-update-notice" role="status" aria-live="polite">
    <span><strong>App update ready to use.</strong> Reload when your current work is saved.</span>
    {!state.canReload&&<small>Save or close your current work before reloading.</small>}
    <Button disabled={!state.canReload} onClick={pwa.reloadApp}><RefreshCw size={16}/>Reload app</Button>
  </div>;
}

export function ForegroundNotificationHandler({userId,authReady}:{userId:string|null|undefined;authReady:boolean}){
  const current=useRef({userId,authReady});
  const pendingRoute=useRef<string|null>(null);

  const openPendingRoute=()=>{
    const route=pendingRoute.current;
    if(!route||!current.current.userId||!current.current.authReady)return;
    pendingRoute.current=null;
    window.history.replaceState(window.history.state,'',route);
    window.dispatchEvent(new CustomEvent('nutrition-push-navigation',{detail:{route}}));
  };

  useEffect(()=>{
    current.current={userId,authReady};
    openPendingRoute();
  },[userId,authReady]);

  useEffect(()=>{
    let disposed=false;
    let stopListening:(()=>void)|undefined;
    if(isNativeAndroid()){
      void listenForNativePushActions(data=>{
        const reminder=parseNutritionReminderPayload({data},window.location.origin);
        if(!reminder)return;
        pendingRoute.current=reminder.route;
        openPendingRoute();
      }).then(stop=>{
        if(disposed)stop();
        else stopListening=stop;
      }).catch(()=>{});
      return()=>{
        disposed=true;
        stopListening?.();
      };
    }
    const start=async()=>{
      if(!isFirebasePushConfigured()||typeof Notification==='undefined'||Notification.permission!=='granted'||stopListening)return;
      try{
        const unsubscribe=await onForegroundMessage(payload=>{
          if(disposed||!navigator.serviceWorker)return;
          const reminder=parseNutritionReminderPayload(payload,window.location.origin);
          if(!reminder)return;
          const route=reminder.route;
          void waitForAppServiceWorker().then(registration=>registration.showNotification(
            payload.notification?.title??'Nutrition check-in',
            {body:payload.notification?.body??'Open Nutrition to review your check-in.',icon:'/icon-192.png',badge:'/icon-192.png',tag:'nutrition-check-in',data:{route}}
          )).catch(()=>{});
        });
        if(disposed)unsubscribe();
        else stopListening=unsubscribe;
      }catch{/* Push availability is optional; Settings reports configuration failures. */}
    };
    const stop=()=>{stopListening?.();stopListening=undefined;};
    const refresh=()=>{if(typeof Notification!=='undefined'&&Notification.permission==='granted')void start();else stop();};
    window.addEventListener('focus',refresh);
    window.addEventListener('nourish-push-enabled',refresh);
    window.addEventListener('nourish-push-disabled',stop);
    void start();
    return()=>{
      disposed=true;
      stop();
      window.removeEventListener('focus',refresh);
      window.removeEventListener('nourish-push-enabled',refresh);
      window.removeEventListener('nourish-push-disabled',stop);
    };
  },[]);

  useEffect(()=>{
    if(!userId||!authReady)return;
    let disposed=false;
    let running=false;
    let removeAppState:(()=>void)|undefined;
    const deviceId=getOrCreatePushDeviceId();
    const run=async()=>{
      if(disposed||running)return;
      running=true;
      try{await reconcileNotificationDevice(userId,deviceId);}
      catch(error){console.warn('Could not refresh this device notification registration.',error);}
      finally{running=false;}
    };
    window.addEventListener('focus',run);
    window.addEventListener('online',run);
    void run();
    if(isNativeAndroid()){
      void App.addListener('appStateChange',({isActive})=>{if(isActive)void run();}).then(handle=>{
        if(disposed)void handle.remove();
        else removeAppState=()=>{void handle.remove();};
      }).catch(()=>{});
    }
    return()=>{
      disposed=true;
      removeAppState?.();
      window.removeEventListener('focus',run);
      window.removeEventListener('online',run);
    };
  },[userId,authReady]);
  return null;
}

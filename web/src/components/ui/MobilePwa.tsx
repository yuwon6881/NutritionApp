import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Check,Download,HardDrive,RefreshCw,Wifi,WifiOff} from 'lucide-react';
import type {Nourish} from '../../useNourish';
import {countFoodBasketDrafts,countFoodScanDrafts} from '../../lib/local';
import {isFirebasePushConfigured} from '../../lib/push/firebaseConfig';
import {onForegroundMessage} from '../../lib/push/firebaseMessaging';
import {getPwaUpdateNoticeState,hasUncommittedPwaWork} from '../../lib/pwaUpdate';
import {summarizePwaPendingWork} from '../../lib/pwaReadiness';
import {registerAppServiceWorker,waitForAppServiceWorker} from '../../lib/registerAppServiceWorker';
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
  serviceWorkerStatus:'checking'|'ready'|'failed'|'unsupported';
  serviceWorkerError:string;
  retryServiceWorker:()=>void;
  appVersion:string;
}

const MobilePwaContext=createContext<MobilePwaContextValue|null>(null);

function standaloneMode(){
  return window.matchMedia('(display-mode: standalone)').matches
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
  const [serviceWorkerStatus,setServiceWorkerStatus]=useState<MobilePwaContextValue['serviceWorkerStatus']>('checking');
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
      const inspect=()=>{
        if(registration.waiting)setWaitingWorker(registration.waiting);
      };
      const onUpdateFound=()=>{
        const worker=registration.installing;
        if(!worker)return;
        worker.addEventListener('statechange',()=>{
          if(worker.state==='installed'&&navigator.serviceWorker.controller)setWaitingWorker(registration.waiting??worker);
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
    if(!('serviceWorker' in navigator))setServiceWorkerStatus('unsupported');
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
  const state=getPwaUpdateNoticeState(pwa.reloadPending,pwa.waiting,pwa.editorOpen);
  if(state.kind==='none')return null;
  if(state.kind==='activated')return <div className="notice pwa-update-notice" role="status" aria-live="polite">
    <span><strong>App update ready to use.</strong> Reload when your current work is saved.</span>
    {!state.canReload&&<small>Save or close your current work before reloading.</small>}
    <Button disabled={!state.canReload} onClick={pwa.reloadApp}><RefreshCw size={16}/>Reload app</Button>
  </div>;
  return <div className="notice pwa-update-notice" role="status" aria-live="polite">
    <span><strong>App update available.</strong> Your saved offline work stays on this device.</span>
    {!state.canActivate&&<small>Save or close your current work before updating.</small>}
    <Button disabled={!state.canActivate} onClick={pwa.applyUpdate}><RefreshCw size={16}/>Prepare update</Button>
  </div>;
}

export function ForegroundNotificationHandler(){
  useEffect(()=>{
    let disposed=false;
    let stopListening:(()=>void)|undefined;
    const start=async()=>{
      if(!isFirebasePushConfigured()||typeof Notification==='undefined'||Notification.permission!=='granted'||stopListening)return;
      try{
        const unsubscribe=await onForegroundMessage(payload=>{
          if(disposed||!navigator.serviceWorker)return;
          const route=typeof payload.data?.route==='string'?payload.data.route:'/';
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
  return null;
}

function formatBytes(value?:number){
  if(value==null||!Number.isFinite(value))return 'Unavailable';
  if(value<1024)return `${Math.round(value)} bytes`;
  const units=['KB','MB','GB'];
  let amount=value/1024;
  let index=0;
  while(amount>=1024&&index<units.length-1){amount/=1024;index++;}
  return `${amount.toFixed(amount>=10?0:1)} ${units[index]}`;
}

function isIos(){
  const platform=navigator.platform??'';
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)||(/MacIntel/i.test(platform)&&navigator.maxTouchPoints>1);
}

function pendingWork(store:Nourish,foodScanDraftCount:number|null){
  const queue=store.local?.queue??[];
  const photos=store.local?.photoDrafts??[];
  const body=store.local?.bodyDrafts??[];
  return summarizePwaPendingWork(
    queue.length,photos.length,body.length,
    queue.filter(item=>!!item.error).length+photos.filter(item=>!!item.error).length+body.filter(item=>!!item.error).length,
    foodScanDraftCount
  );
}

export function PwaReadiness({store}:{store:Nourish}){
  const pwa=useMobilePwa();
  const [foodDraftCount,setFoodDraftCount]=useState<number|null>(null);
  useEffect(()=>{
    let current=true;
    void countFoodBasketDrafts(store.state!.id).then(count=>{if(current)setFoodDraftCount(count);}).catch(()=>{if(current)setFoodDraftCount(-1);});
    return()=>{current=false;};
  },[store.state!.id]);
  const [foodScanDraftCount,setFoodScanDraftCount]=useState<number|null>(null);
  useEffect(()=>{
    let current=true;
    let revision=0;
    setFoodScanDraftCount(null);
    const refresh=()=>{
      const requested=++revision;
      void countFoodScanDrafts(store.state!.id).then(count=>{if(current&&requested===revision)setFoodScanDraftCount(count);}).catch(()=>{if(current&&requested===revision)setFoodScanDraftCount(-1);});
    };
    refresh();
    window.addEventListener('nutrition-scan-drafts-changed',refresh);
    window.addEventListener('focus',refresh);
    return()=>{current=false;window.removeEventListener('nutrition-scan-drafts-changed',refresh);window.removeEventListener('focus',refresh);};
  },[store.state!.id]);
  const pending=pendingWork(store,foodScanDraftCount);
  const usage=pwa.storage.used==null?'Storage use unavailable':`${formatBytes(pwa.storage.used)} used${pwa.storage.quota==null?'':` of ${formatBytes(pwa.storage.quota)}`}`;
  const ios=isIos();
  const offlineData=store.local
    ?`Saved foods: ${store.local.foodsLoaded?'available offline':'not loaded yet'} · recent diary: ${store.local.state.entries.length?'available on this device':'will load as you browse'}`
    :'Offline data is being checked.';

  return <section className="panel pwa-readiness" aria-labelledby="pwa-readiness-title">
    <h2 id="pwa-readiness-title">Mobile app and offline data</h2>
    <p className="source">Install Nutrition App on your phone to open it from the Home Screen and use the cached diary when you are offline.</p>
    <dl className="pwa-readiness-list">
      <div><dt>App</dt><dd>{pwa.installed?'Installed on this device':'Open in a browser'} · version {__APP_VERSION__}</dd></div>
      <div><dt>Connection</dt><dd>{pwa.online?<><Wifi size={15} aria-hidden="true"/> Online</>:<><WifiOff size={15} aria-hidden="true"/> Offline</>}</dd></div>
      <div><dt>Offline support</dt><dd>{pwa.serviceWorkerStatus==='checking'?'Checking app setup…':pwa.serviceWorkerStatus==='ready'?'Ready on this device':pwa.serviceWorkerStatus==='unsupported'?'Not available in this browser':'Could not start'}</dd></div>
      <div><dt>Offline data</dt><dd>{offlineData}</dd></div>
      <div><dt>Saved changes</dt><dd>{!pending.complete?'Checking retained scan work before showing status…':pending.total===0?'No pending changes':`${pending.total} pending items on this device`}{pending.needsReview?` · ${pending.needsReview} need review`:''}</dd></div>
      <div><dt>Food batches</dt><dd>{foodDraftCount===null?'Checking saved batches…':foodDraftCount<0?'Could not check saved batches':foodDraftCount===0?'No unfinished batch':`${foodDraftCount} unfinished batch${foodDraftCount===1?'':'es'} saved on this device`}</dd></div>
      <div><dt>Food scans</dt><dd>{foodScanDraftCount===null?'Checking retained scans…':foodScanDraftCount<0?'Could not check retained scans; pending photos may need attention':foodScanDraftCount===0?'No retained scans':`${foodScanDraftCount} retained scan${foodScanDraftCount===1?'':'s'} awaiting review or sync`}</dd></div>
      <div><dt>Device storage</dt><dd>{pwa.storage.persistent===true?'Persistent storage enabled':pwa.storage.persistent===false?'Browser managed retention':'Retention status unavailable'} · {usage}</dd></div>
    </dl>
    <div className="actions pwa-readiness-actions">
      {!pwa.installed&&pwa.installAvailable&&<Button onClick={()=>void pwa.install()}><Download size={16}/>Install app</Button>}
      {!pwa.installed&&!pwa.installAvailable&&<span className="source">{ios
        ?'iPhone or iPad: in Safari, tap Share → Add to Home Screen. On iOS 26 or later, choose Open as Web App if offered.'
        :'Android: open the browser menu and choose Install app or Add to Home screen.'}</span>}
      {pwa.serviceWorkerStatus==='failed'&&<Button variant="secondary" onClick={pwa.retryServiceWorker}><RefreshCw size={16}/>Retry offline setup</Button>}
      {pwa.storage.persistent!==true&&pwa.storage.supported&&<Button variant="secondary" disabled={pwa.storageBusy} onClick={()=>void pwa.requestPersistentStorage()}><HardDrive size={16}/>{pwa.storageBusy?'Checking…':'Protect local data'}</Button>}
      {pwa.storage.persistent===true&&<span className="pwa-persisted-status"><Check size={16} aria-hidden="true"/> Browser retention enabled</span>}
    </div>
    {pwa.serviceWorkerError&&<p className="source" role="status">{pwa.serviceWorkerError}</p>}
    {pwa.storageMessage&&<p className="source" role="status">{pwa.storageMessage}</p>}
    <p className="source pwa-storage-note">Persistent storage reduces browser cleanup risk; it is not a backup. Keep the app connected so account data can sync.</p>
  </section>;
}

import {lazy,Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {Utensils,BookOpen,Plus,Scale,Camera,ChartNoAxesCombined,Compass,Settings as SettingsIcon,LoaderCircle,Sparkles} from 'lucide-react';
import type {AiUiAction} from './lib/api/ai';
import {api,ApiError,clearApiCooldowns} from './lib/api';
import {getLocalDatabaseFailure} from './lib/local';
import {hydrateAccount,clearAccountHydration} from './lib/accountHydration';
import {measurePerformance} from './lib/performance';
import {today} from './lib/format';
import {watchTheme} from './lib/theme';
import {useNourish} from './useNourish';
import type {Entry,Weight} from './types';
import {Button} from './components/ui/Button';
import {Brand} from './components/ui/Brand';
import {ActionSheet,type ActionSheetOption} from './components/ui/ActionSheet';
import {Auth} from './components/Auth';
import {Today} from './components/Today';
import {FoodDiary} from './components/FoodDiary';
import {WeightEntryDialog} from './components/WeightEntryDialog';
import {CopyDayDialog} from './components/CopyDayDialog';
import {MissedDays} from './components/MissedDays';
import {MotionScene,SelectionIndicator} from './components/ui/Motion';
import {SyncConflictNotice} from './components/SyncConflictNotice';
import {SyncStatus} from './components/ui/SyncStatus';
import {UndoToastHost} from './components/ui/UndoToast';
import {DashboardSkeleton} from './components/ui/Skeleton';
import {ForegroundNotificationHandler,PwaUpdateNotice} from './components/ui/MobilePwa';
import {readPushDeviceCredential,savePushRevocation} from './lib/local';
import {getOrCreatePushDeviceId} from './lib/push/deviceId';
import {drainPendingPushRevocations} from './lib/push/revocations';
import {disableLocalPushForPlatform} from './lib/push/deviceLifecycle';
import {backCoordinator,isLayerEntry,readState,PAGE_KEY} from './lib/appHistory';
import {BACK_TO_HOME_EVENT} from './lib/nativeApp';
import {captureNutritionShortcut,clearPendingNutritionShortcut,consumeReadyNutritionShortcut} from './lib/nutritionShortcuts';

// Dashboard and Food Log stay in the first bundle; the other views load on first visit and are precached for offline use.
const Progress=lazy(()=>import('./components/Progress').then(module=>({default:module.Progress})));
const Coach=lazy(()=>import('./components/Coach').then(module=>({default:module.Coach})));
const Settings=lazy(()=>import('./components/Settings').then(module=>({default:module.Settings})));
// The food dialog mounts on first use; its chunk is warmed once the app is idle.
const loadLogFood=()=>import('./components/LogFood');
const LogFood=lazy(()=>loadLogFood().then(module=>({default:module.LogFood})));
const AiAssistantPanel=lazy(()=>import('./components/AiAssistantPanel').then(module=>({default:module.AiAssistantPanel})));

type Page='today'|'food'|'progress'|'coach'|'settings';
const PAGES:readonly Page[]=['today','food','progress','coach','settings'];
const asPage=(value:unknown):Page|undefined=>PAGES.find(page=>page===value);

function Workspace({user,authReady,onLogout,onUsable}:{user:string;authReady:boolean;onLogout:()=>Promise<void>;onUsable?:()=>void}){
  const firstUsable=useRef<(()=>void)|undefined>(undefined);
  if(!firstUsable.current)firstUsable.current=measurePerformance('dashboard.usable');
  const store=useNourish(user);
  const dashboardMarked=useRef(false);
  useEffect(()=>{
    if(!store.state||dashboardMarked.current)return;
    dashboardMarked.current=true;
    const frame=requestAnimationFrame(()=>{firstUsable.current?.();onUsable?.();});
    return()=>cancelAnimationFrame(frame);
  },[!!store.state]);
  const initialPage=typeof window!=='undefined'&&window.location.pathname==='/coach'?'coach':typeof window!=='undefined'&&(window.location.pathname==='/settings'||window.location.search.includes('google_health'))?'settings':'today';
  const [page,setPage]=useState<Page>(initialPage);
  const [date,setDate]=useState(today());
  const [foodOpen,setFoodOpen]=useState(false);
  const foodOpening=useRef<(()=>void)|undefined>(undefined);
  const foodMounted=useRef(false);
  if(foodOpen)foodMounted.current=true;
  useEffect(()=>{
    if(!store.state)return;
    const warm=()=>{void loadLogFood().catch(()=>{});};
    if(typeof window.requestIdleCallback==='function'){const id=window.requestIdleCallback(warm,{timeout:4000});return()=>window.cancelIdleCallback(id);}
    const timer=window.setTimeout(warm,2000);
    return()=>window.clearTimeout(timer);
  },[!!store.state]);
  const [foodDate,setFoodDate]=useState(today());
  const [foodInitialTime,setFoodInitialTime]=useState<string>();
  const [foodInitialQuery,setFoodInitialQuery]=useState<string>();
  const [foodEditing,setFoodEditing]=useState<Entry>();
  const [foodInitialTab,setFoodInitialTab]=useState<'search'|'saved'|'barcode'|'ai'>('search');
  const [foodReturnFocus,setFoodReturnFocus]=useState<HTMLElement|null>(null);
  const [foodOriginPage,setFoodOriginPage]=useState<Page>('today');
  const [weightOpen,setWeightOpen]=useState(false);
  const [weightDate,setWeightDate]=useState(today());
  const [weightEditing,setWeightEditing]=useState<Weight>();
  const [weightReturnFocus,setWeightReturnFocus]=useState<HTMLElement|null>(null);
  const [copyOpen,setCopyOpen]=useState(false);
  const [copyDate,setCopyDate]=useState(today());
  const [copyEntries,setCopyEntries]=useState<Entry[]>([]);
  const [copyReturnFocus,setCopyReturnFocus]=useState<HTMLElement|null>(null);
  const [showAddSheet,setShowAddSheet]=useState(false);
  const [addReturnFocus,setAddReturnFocus]=useState<HTMLElement|null>(null);
  const [aiOpen,setAiOpen]=useState(false);

  const handleAiActions=async(actions:AiUiAction[])=>{
    for(const action of actions){
      switch(action.type){
        case 'openFoodLog':
          if(typeof action.payload.date==='string'){setDate(action.payload.date);setFoodDate(action.payload.date);}
          requestPage('food');
          break;
        case 'openAddFoodDraft':
          openFood(typeof action.payload.date==='string'?action.payload.date:selectedEntryDate,undefined,'search',null,typeof action.payload.time==='string'?action.payload.time:undefined,typeof action.payload.query==='string'?action.payload.query:undefined);
          break;
        case 'openWeightEntry':
          openWeight((action.payload.date as string)||activeDate);
          break;
        case 'openCoaching':
          requestPage('coach');
          break;
        case 'openExpenditure':
          requestPage('progress');
          break;
        case 'openBarcodeScanner':
          openFood(selectedEntryDate,undefined,'barcode');
          break;
      }
    }
  };
  const needsProfile=!!store.state&&!store.state.profile;
  const conflictCount=store.local?.queue.filter(queue=>queue.error).length??0;

  const pageRef=useRef(page);
  pageRef.current=page;
  // A page change requested while a dialog is closing waits for that dialog's
  // history entry to unwind, then records itself on top of the page below.
  const pendingPage=useRef<Page|null>(null);
  const showPage=(next:Page)=>{
    const finish=measurePerformance('navigation');
    setPage(next);window.scrollTo({top:0,behavior:'instant'});
    window.requestAnimationFrame(finish);
  };
  const requestPage=(next:Page)=>{
    if(next===pageRef.current)return;
    if(!isLayerEntry(readState(window.history))){backCoordinator().pushPage(next);showPage(next);return;}
    pendingPage.current=next;
    showPage(next);
    window.setTimeout(()=>{
      if(pendingPage.current!==next)return;
      pendingPage.current=null;
      backCoordinator().pushPage(next);
    },600);
  };

  // Record the first page once so Back from later pages can return to it.
  useEffect(()=>{backCoordinator().replacePage(initialPage);},[]);
  useEffect(()=>{
    const onPopState=()=>{
      const state=readState(window.history);
      if(pendingPage.current){
        // Dialog and layer entries are still unwinding; the requested page is already showing.
        if(isLayerEntry(state))return;
        const next=pendingPage.current;
        pendingPage.current=null;
        backCoordinator().pushPage(next);
        if(next!==pageRef.current)showPage(next);
        return;
      }
      const target=asPage(state[PAGE_KEY])??'today';
      if(target!==pageRef.current)showPage(target);
    };
    const goHome=()=>{backCoordinator().replacePage('today');showPage('today');};
    window.addEventListener('popstate',onPopState);
    window.addEventListener(BACK_TO_HOME_EVENT,goHome);
    return()=>{window.removeEventListener('popstate',onPopState);window.removeEventListener(BACK_TO_HOME_EVENT,goHome);};
  },[]);
  useEffect(()=>{if(needsProfile){backCoordinator().replacePage('coach');setPage('coach');}},[needsProfile]);
  useEffect(()=>{
    const openCoachFromPush=(event:Event)=>{
      const route=(event as CustomEvent<{route?:string}>).detail?.route;
      if(route!=='/coach')return;
      setFoodOpen(false);setWeightOpen(false);setCopyOpen(false);setShowAddSheet(false);
      requestPage('coach');
    };
    window.addEventListener('nutrition-push-navigation',openCoachFromPush);
    return()=>window.removeEventListener('nutrition-push-navigation',openCoachFromPush);
  },[]);
  useEffect(()=>{if(store.state?.profile){const current=today(store.state.profile.timeZone);setDate(current);setFoodDate(current);setWeightDate(current);setCopyDate(current);}},[store.state?.profile?.timeZone]);

  const openFood=(selectedDate:string,entry?:Entry,tab:'search'|'saved'|'barcode'|'ai'|boolean='search',restoreFocus?:HTMLElement|null,initialTime?:string,initialQuery?:string)=>{
    foodOpening.current?.();
    foodOpening.current=measurePerformance('food.open');
    const initialSection=typeof tab==='string'?tab:tab?'barcode':'search';
    setFoodDate(selectedDate);setFoodEditing(entry);setFoodInitialTab(initialSection);setFoodInitialTime(initialTime);setFoodInitialQuery(initialQuery);setFoodReturnFocus(restoreFocus??null);setFoodOriginPage(page);setFoodOpen(true);
  };
  const openWeight=(selectedDate:string,entry?:Weight,restoreFocus?:HTMLElement|null)=>{
    setWeightDate(selectedDate);setWeightEditing(entry);setWeightReturnFocus(restoreFocus??null);setWeightOpen(true);
  };
  const openCopy=(sourceDate:string,entries:Entry[],restoreFocus?:HTMLElement|null)=>{
    setCopyDate(sourceDate);setCopyEntries(entries);setCopyReturnFocus(restoreFocus??null);setCopyOpen(true);
  };
  const activeDate=store.state?.profile?today(store.state.profile.timeZone):date;
  const selectedEntryDate=page==='food'?foodDate:activeDate;
  useEffect(()=>{
    if(!authReady||!store.state?.profile)return;
    let action:ReturnType<typeof consumeReadyNutritionShortcut>=null;
    try{action=consumeReadyNutritionShortcut(window.localStorage,{authenticated:authReady,profileReady:!!store.state?.profile});}catch{/* Browser storage can be unavailable; keep the app usable. */}
    if(!action)return;
    setPage('today');
    setDate(activeDate);
    if(action==='log-food'||action==='scan-barcode'){
      setFoodDate(activeDate);
      setFoodEditing(undefined);
      setFoodInitialTime(undefined);
      setFoodInitialTab(action==='scan-barcode'?'barcode':'search');
      setFoodReturnFocus(null);
      setFoodOriginPage('today');
      setFoodOpen(true);
    }else{
      setWeightDate(activeDate);
      setWeightEditing(undefined);
      setWeightReturnFocus(null);
      setWeightOpen(true);
    }
  },[authReady,store.state?.profile,activeDate]);
  const addOptions:ActionSheetOption[]=[
    {id:'food',label:'Log food',description:'Choose a saved food or enter a meal.',icon:<Utensils size={20}/>,onClick:()=>openFood(selectedEntryDate,undefined,'search',addReturnFocus)},
    {id:'weight',label:'Log weight',description:'Record your scale weight.',icon:<Scale size={20}/>,onClick:()=>openWeight(selectedEntryDate,undefined,addReturnFocus)},
    {id:'scan',label:'Scan food or label',description:'Scan a packaged food barcode or nutrition label.',icon:<Camera size={20}/>,onClick:()=>openFood(selectedEntryDate,undefined,'barcode',addReturnFocus)},
  ];
  const navigate=(next:Page)=>{
    if(next===page){
      const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({top:0,behavior:reduce?'instant':'smooth'});
      return;
    }
    if(next==='food')setFoodDate(date);
    requestPage(next);
  };
  const foodSavedPage=foodOriginPage==='food'?'food':'today';
  const nav=[
    {id:'today',label:'Dashboard',icon:Utensils},
    {id:'food',label:'Food Log',icon:BookOpen},
    {id:'progress',label:'Progress',icon:ChartNoAxesCombined},
    {id:'coach',label:'Coach',icon:Compass},
    {id:'settings',label:'Settings',icon:SettingsIcon},
  ] as const;

  // Background sync indicators update independently of the live page's data.
  const pageContent=useMemo(()=>!needsProfile&&page==='today'?<Today store={store} onCoach={()=>navigate('coach')} onSettings={()=>navigate('settings')}/>:!needsProfile&&page==='food'?<FoodDiary store={store} date={foodDate} setDate={setFoodDate} onLog={time=>openFood(foodDate,undefined,false,null,time)} onEdit={entry=>openFood(entry.date,entry)} onCopyDay={openCopy}/>:!needsProfile&&page==='progress'?<Progress store={store} onSettings={()=>navigate('settings')}/>:needsProfile||page==='coach'?<Coach store={store} onboarding={needsProfile}/>:<Settings store={store} onLogout={onLogout}/>,[needsProfile,page,store.state,store.local,store.error,store.busy,store.trainingLoading,store.trainingError,store.calendarDate,foodDate,date,onLogout]);

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Nutrition home"><Brand/><span>Nutrition</span></a>
      <nav aria-label="Main navigation">
        <SelectionIndicator active={page} className="nav-mobile-items nav-selection">
          <Button data-selection-key="today" disabled={needsProfile} variant="tertiary" className={page==='today'?'nav-active':''} aria-current={page==='today'?'page':undefined} onClick={()=>navigate('today')}><Utensils size={20}/><span>Dashboard</span></Button>
          <Button data-selection-key="food" disabled={needsProfile} variant="tertiary" className={page==='food'?'nav-active':''} aria-current={page==='food'?'page':undefined} onClick={()=>navigate('food')}><BookOpen size={20}/><span>Food Log</span></Button>
          <Button disabled={needsProfile} variant="primary" className="nav-center-add" aria-label="Add entry" onClick={event=>{setAddReturnFocus(event.currentTarget);setShowAddSheet(true);}}><Plus size={22} className="nav-icon"/><span>Add</span></Button>
          <Button data-selection-key="progress" disabled={needsProfile} variant="tertiary" className={page==='progress'?'nav-active':''} aria-current={page==='progress'?'page':undefined} onClick={()=>navigate('progress')}><ChartNoAxesCombined size={20}/><span>Progress</span></Button>
          <Button data-selection-key="coach" variant="tertiary" className={page==='coach'?'nav-active':''} aria-current={page==='coach'?'page':undefined} onClick={()=>navigate('coach')}><Compass size={20}/><span>Coach</span></Button>
        </SelectionIndicator>
        <SelectionIndicator active={page} className="nav-desktop-items nav-selection">
          <Button disabled={needsProfile} variant="primary" className="nav-add-desktop" aria-label="Add entry" title="Add entry" onClick={event=>{setAddReturnFocus(event.currentTarget);setShowAddSheet(true);}}><Plus size={19}/><span>Add entry</span></Button>
          {nav.map(item=>{const Icon=item.icon;return <Button data-selection-key={item.id} key={item.id} disabled={needsProfile&&item.id!=='coach'} variant="tertiary" className={page===item.id?'nav-active':''} aria-current={page===item.id?'page':undefined} onClick={()=>navigate(item.id)}><Icon size={21}/><span>{item.label}</span></Button>;})}
          <Button disabled={needsProfile} variant="tertiary" className="nav-ai-button" aria-label="Ask AI" onClick={()=>setAiOpen(true)}><Sparkles size={21}/><span>Ask AI</span></Button>
        </SelectionIndicator>
      </nav>
    </aside>
    <main id="main-content" className="main-content" tabIndex={-1}>
      <div className="topbar">
        <span className="account-name">{store.state?.displayName}</span>
        <div className="topbar-activity" role="status" aria-label="Activity indicator" aria-live="polite">
          {store.isActivityActive && (
            <span className="topbar-activity-indicator" aria-label="Working…">
              <LoaderCircle size={16} className="topbar-activity-spinner" aria-hidden="true"/>
            </span>
          )}
        </div>
        {needsProfile&&<Button variant="tertiary" onClick={()=>void onLogout()}>Sign out</Button>}
        <Button disabled={needsProfile} variant="tertiary" size="icon" aria-label="Ask AI" title="Ask AI" onClick={()=>setAiOpen(true)}><Sparkles size={20}/></Button>
        <Button disabled={needsProfile} variant="tertiary" size="icon" className={`mobile-settings ${page==='settings'?'nav-active':''}`} aria-label="Settings" aria-current={page==='settings'?'page':undefined} onClick={()=>navigate('settings')}><SettingsIcon size={21}/></Button>
      </div>
      <SyncStatus store={store}/>
      <UndoToastHost/>
      <PwaUpdateNotice/>
      {store.error&&!conflictCount&&<div className="notice" role="status">{store.error}<Button variant="tertiary" onClick={()=>void store.drain()} disabled={store.busy}>Retry connection</Button></div>}
      <SyncConflictNotice store={store}/>
      {!store.state?<><DashboardSkeleton label="Opening your diary…"/><div className="actions"><Button variant="tertiary" onClick={()=>void onLogout()}>Back to sign in</Button></div></>:<Suspense fallback={<DashboardSkeleton label="Opening this page…"/>}><MotionScene sceneKey={needsProfile?'coach':page}>
        {pageContent}
      </MotionScene></Suspense>}
      {store.state?.profile&&<MissedDays store={store}/>}
      {store.state&&<>
        {foodMounted.current&&<Suspense fallback={null}><LogFood key={`${foodDate}:${foodEditing?.id??'new'}:${foodInitialTab}:${foodInitialTime??''}`} open={foodOpen} store={store} date={foodDate} editing={foodEditing} initialTab={foodInitialTab} initialAi={foodInitialTab==='ai'} onReady={()=>foodOpening.current?.()} initialTime={foodInitialTime} initialQuery={foodInitialQuery} restoreFocus={foodReturnFocus} onClose={()=>setFoodOpen(false)} onSaved={()=>{setFoodOpen(false);setDate(foodDate);setFoodDate(foodDate);requestPage(foodSavedPage);}}/></Suspense>}
        <WeightEntryDialog open={weightOpen} store={store} date={weightDate} initial={weightEditing} restoreFocus={weightReturnFocus} onClose={()=>setWeightOpen(false)}/>
        <CopyDayDialog open={copyOpen} store={store} sourceDate={copyDate} entries={copyEntries} restoreFocus={copyReturnFocus} onClose={()=>setCopyOpen(false)}/>
      </>}
      {aiOpen&&<Suspense fallback={null}><AiAssistantPanel isOpen={aiOpen} onClose={()=>setAiOpen(false)} onActions={handleAiActions} surface={page}/></Suspense>}
    </main>
    <ActionSheet isOpen={showAddSheet} onClose={()=>setShowAddSheet(false)} restoreFocus={addReturnFocus} title="Add" subtitle={`${selectedEntryDate===activeDate?'Today · ':''}${selectedEntryDate}`} options={addOptions}/>
  </div>;
}

export default function App({onUsable}:{onUsable?:()=>void}={}){
  const [user,setUser]=useState<string|null>();
  useEffect(()=>{clearApiCooldowns();},[user]);
  const [authReady,setAuthReady]=useState(false);
  const [localDatabaseError,setLocalDatabaseError]=useState(getLocalDatabaseFailure);
  useEffect(()=>{
    const onDatabaseFailure=(event:Event)=>setLocalDatabaseError((event as CustomEvent<string>).detail||getLocalDatabaseFailure());
    window.addEventListener('nutrition-local-database-error',onDatabaseFailure);
    setLocalDatabaseError(getLocalDatabaseFailure());
    return()=>window.removeEventListener('nutrition-local-database-error',onDatabaseFailure);
  },[]);
  useEffect(()=>{
    const drain=()=>{void drainPendingPushRevocations().catch(()=>{});};
    drain();
    window.addEventListener('online',drain);
    window.addEventListener('focus',drain);
    return()=>{
      window.removeEventListener('online',drain);
      window.removeEventListener('focus',drain);
    };
  },[]);
  useEffect(()=>{
    const stopWatchingTheme=watchTheme();
    let active=true;
    void (async()=>{
      try{
        const shortcut=captureNutritionShortcut(window.location.href,window.localStorage);
        if(shortcut)window.history.replaceState(null,'',shortcut.cleanUrl);
      }catch{/* Keep the original shortcut URL if browser storage is blocked. */}
      const params=typeof window!=='undefined'?new URLSearchParams(window.location.search):null;
      if(params?.has('auth')){
        try{localStorage.removeItem('nourish-signed-out');}catch{}
        const cleanUrl=window.location.pathname+(window.location.hash||'');
        window.history.replaceState(null,'',cleanUrl);
      }
      if(localStorage.getItem('nourish-signed-out')==='1'){setUser(null);setAuthReady(true);return;}
      const previous=localStorage.getItem('nourish-account');let cached=false;
      const finishHydration=measurePerformance('startup.hydration');
      const validation=api<{id:string;displayName?:string}>('/auth/me');
      // Attach a rejection handler while local storage is opening; validation proceeds in parallel.
      void validation.catch(()=>{});
      try{cached=!!previous&&!!await hydrateAccount(previous);}catch{/* Try the server if local storage is unavailable. */}
      finally{finishHydration();}
      if(active&&cached)setUser(previous);
      try{
        const account=await validation;
        if(active&&localStorage.getItem('nourish-signed-out')!=='1'){localStorage.setItem('nourish-account',account.id);setUser(account.id);setAuthReady(true);}
      }catch(ex){if(active){if(!cached||(ex instanceof ApiError&&ex.status===401))setUser(null);setAuthReady(true);}}
    })();
    return()=>{active=false;stopWatchingTheme();};
  },[]);

  const logout=async()=>{
    clearAccountHydration();
    if(user){
      try{
        const deviceId=getOrCreatePushDeviceId();
        const credential=await readPushDeviceCredential(user,deviceId);
        if(credential){
          await savePushRevocation(user,deviceId,credential.fcmToken);
          await disableLocalPushForPlatform().catch(()=>{});
          await drainPendingPushRevocations({signal:AbortSignal.timeout(3000)});
        }
      }catch{/* Keep the exact account/device/token revocation for a later retry. */}
    }
    try{clearPendingNutritionShortcut(window.localStorage);}catch{/* The action cannot be retained when browser storage is blocked. */}
    localStorage.setItem('nourish-signed-out','1');
    localStorage.removeItem('nourish-account');
    setUser(null);
    try{await api('/auth/logout',{});}catch{/* Explicit signed-out marker prevents an offline logout from reopening via an old cookie. */}
  };
  if(user===undefined)return <main className="startup"><Brand size={38}/></main>;
  return <>
    {localDatabaseError&&<div className="notice" role="alert">{localDatabaseError}</div>}
    <ForegroundNotificationHandler userId={user} authReady={authReady}/>
    {user?<Workspace key={user} user={user} authReady={authReady} onLogout={logout} onUsable={onUsable}/>:<Auth onLogin={id=>{localStorage.removeItem('nourish-signed-out');setUser(id);void drainPendingPushRevocations().catch(()=>{});}}/>}
  </>;
}

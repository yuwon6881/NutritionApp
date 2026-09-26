import {useEffect,useRef,useState} from 'react';
import {Utensils,BookOpen,Plus,Scale,Camera,ChartNoAxesCombined,Compass,Settings as SettingsIcon,LoaderCircle} from 'lucide-react';
import {api,ApiError} from './lib/api';
import {getLocalDatabaseFailure,readLocal} from './lib/local';
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
import {LogFood} from './components/LogFood';
import {WeightEntryDialog} from './components/WeightEntryDialog';
import {CopyDayDialog} from './components/CopyDayDialog';
import {Progress} from './components/Progress';
import {Coach} from './components/Coach';
import {Settings} from './components/Settings';
import {MissedDays} from './components/MissedDays';
import {MotionScene,SelectionIndicator} from './components/ui/Motion';
import {SyncConflictNotice} from './components/SyncConflictNotice';
import {SyncStatus} from './components/ui/SyncStatus';
import {ForegroundNotificationHandler,PwaUpdateNotice} from './components/ui/MobilePwa';
import {readPushDeviceCredential,savePushRevocation} from './lib/local';
import {getOrCreatePushDeviceId} from './lib/push/deviceId';
import {retryPendingPushRevocations} from './lib/push/revocations';
import {disableLocalPushForPlatform} from './lib/push/deviceLifecycle';
import {backCoordinator,isLayerEntry,readState,PAGE_KEY} from './lib/appHistory';
import {BACK_TO_HOME_EVENT} from './lib/nativeApp';
import {captureNutritionShortcut,clearPendingNutritionShortcut,consumeReadyNutritionShortcut} from './lib/nutritionShortcuts';

type Page='today'|'food'|'progress'|'coach'|'settings';
const PAGES:readonly Page[]=['today','food','progress','coach','settings'];
const asPage=(value:unknown):Page|undefined=>PAGES.find(page=>page===value);

function Workspace({user,authReady,onLogout}:{user:string;authReady:boolean;onLogout:()=>Promise<void>}){
  const store=useNourish(user);
  const initialPage=typeof window!=='undefined'&&window.location.pathname==='/coach'?'coach':typeof window!=='undefined'&&(window.location.pathname==='/settings'||window.location.search.includes('google_health'))?'settings':'today';
  const [page,setPage]=useState<Page>(initialPage);
  const [date,setDate]=useState(today());
  const [foodOpen,setFoodOpen]=useState(false);
  const [foodDate,setFoodDate]=useState(today());
  const [foodInitialTime,setFoodInitialTime]=useState<string>();
  const [foodInitialRecent,setFoodInitialRecent]=useState<Entry>();
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
  const needsProfile=!!store.state&&!store.state.profile;
  const conflictCount=store.local?.queue.filter(queue=>queue.error).length??0;

  const pageRef=useRef(page);
  pageRef.current=page;
  // A page change requested while a dialog is closing waits for that dialog's
  // history entry to unwind, then records itself on top of the page below.
  const pendingPage=useRef<Page|null>(null);
  const showPage=(next:Page)=>{setPage(next);window.scrollTo({top:0,behavior:'instant'});};
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

  const openFood=(selectedDate:string,entry?:Entry,tab:'search'|'saved'|'barcode'|'ai'|boolean='search',restoreFocus?:HTMLElement|null,initialTime?:string)=>{
    const initialSection=typeof tab==='string'?tab:tab?'barcode':'search';
    setFoodDate(selectedDate);setFoodEditing(entry);setFoodInitialTab(initialSection);setFoodInitialTime(initialTime);setFoodInitialRecent(undefined);setFoodReturnFocus(restoreFocus??null);setFoodOriginPage(page);setFoodOpen(true);
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

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Nutrition App home"><Brand/><span>Nutrition App</span></a>
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
        <Button disabled={needsProfile} variant="tertiary" size="icon" className={`mobile-settings ${page==='settings'?'nav-active':''}`} aria-label="Settings" aria-current={page==='settings'?'page':undefined} onClick={()=>navigate('settings')}><SettingsIcon size={21}/></Button>
      </div>
      <SyncStatus store={store}/>
      <PwaUpdateNotice/>
      {store.error&&!conflictCount&&<div className="notice" role="status">{store.error}<Button variant="tertiary" onClick={()=>void store.drain()} disabled={store.busy}>Retry connection</Button></div>}
      <SyncConflictNotice store={store}/>
      {!store.state?<section className="panel skeleton" aria-busy="true"><h1>Opening your diary…</h1><Button onClick={()=>void onLogout()}>Back to sign in</Button></section>:<MotionScene sceneKey={needsProfile?'coach':page}>
        {!needsProfile&&page==='today'?<Today store={store} onCoach={()=>navigate('coach')} onSettings={()=>navigate('settings')} onLogAgain={(entry,trigger)=>{openFood(activeDate,undefined,'search',trigger);setFoodInitialRecent(entry);}}/>:!needsProfile&&page==='food'?<FoodDiary store={store} date={foodDate} setDate={setFoodDate} onLog={time=>openFood(foodDate,undefined,false,null,time)} onEdit={entry=>openFood(entry.date,entry)} onCopyDay={openCopy}/>:!needsProfile&&page==='progress'?<Progress store={store} onSettings={()=>navigate('settings')}/>:needsProfile||page==='coach'?<Coach store={store} onboarding={needsProfile}/>:<Settings store={store} onLogout={onLogout}/>}
      </MotionScene>}
      {store.state?.profile&&<MissedDays store={store}/>}
      {store.state&&<>
        <LogFood key={`${foodDate}:${foodEditing?.id??'new'}:${foodInitialTab}:${foodInitialTime??''}:${foodInitialRecent?.id??''}`} open={foodOpen} store={store} date={foodDate} editing={foodEditing} initialRecent={foodInitialRecent} initialTab={foodInitialTab} initialAi={foodInitialTab==='ai'} initialTime={foodInitialTime} restoreFocus={foodReturnFocus} onClose={()=>setFoodOpen(false)} onSaved={()=>{setFoodOpen(false);setDate(foodDate);setFoodDate(foodDate);requestPage(foodSavedPage);}}/>
        <WeightEntryDialog open={weightOpen} store={store} date={weightDate} initial={weightEditing} restoreFocus={weightReturnFocus} onClose={()=>setWeightOpen(false)}/>
        <CopyDayDialog open={copyOpen} store={store} sourceDate={copyDate} entries={copyEntries} restoreFocus={copyReturnFocus} onClose={()=>setCopyOpen(false)}/>
      </>}
    </main>
    <ActionSheet isOpen={showAddSheet} onClose={()=>setShowAddSheet(false)} restoreFocus={addReturnFocus} title="Add" subtitle={`${selectedEntryDate===activeDate?'Today · ':''}${selectedEntryDate}`} options={addOptions}/>
  </div>;
}

export default function App(){
  const [user,setUser]=useState<string|null>();
  const [authReady,setAuthReady]=useState(false);
  const [localDatabaseError,setLocalDatabaseError]=useState(getLocalDatabaseFailure);
  useEffect(()=>{
    const onDatabaseFailure=(event:Event)=>setLocalDatabaseError((event as CustomEvent<string>).detail||getLocalDatabaseFailure());
    window.addEventListener('nutrition-local-database-error',onDatabaseFailure);
    setLocalDatabaseError(getLocalDatabaseFailure());
    return()=>window.removeEventListener('nutrition-local-database-error',onDatabaseFailure);
  },[]);
  useEffect(()=>{
    if(!user||!authReady)return;
    const retry=()=>{void retryPendingPushRevocations(user).catch(()=>{});};
    retry();
    window.addEventListener('online',retry);
    window.addEventListener('focus',retry);
    return()=>{
      window.removeEventListener('online',retry);
      window.removeEventListener('focus',retry);
    };
  },[authReady,user]);
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
      try{cached=!!previous&&!!await readLocal(previous);}catch{/* Try the server if local storage is unavailable. */}
      if(active&&cached)setUser(previous);
      try{
        const account=await api<{id:string;displayName?:string}>('/auth/me');
        if(active&&localStorage.getItem('nourish-signed-out')!=='1'){localStorage.setItem('nourish-account',account.id);setUser(account.id);setAuthReady(true);}
      }catch(ex){if(active){if(!cached||(ex instanceof ApiError&&ex.status===401))setUser(null);setAuthReady(true);}}
    })();
    return()=>{active=false;stopWatchingTheme();};
  },[]);

  const logout=async()=>{
    if(user){
      try{
        const deviceId=getOrCreatePushDeviceId();
        const credential=await readPushDeviceCredential(user,deviceId);
        if(credential){
          await savePushRevocation(user,deviceId,credential.fcmToken);
          await disableLocalPushForPlatform().catch(()=>{});
          await retryPendingPushRevocations(user,{signal:AbortSignal.timeout(3000)});
        }
      }catch{/* Keep the exact account/device/token revocation for a later authenticated retry. */}
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
    {user?<Workspace key={user} user={user} authReady={authReady} onLogout={logout}/>:<Auth onLogin={id=>{localStorage.removeItem('nourish-signed-out');setUser(id);}}/>}
  </>;
}

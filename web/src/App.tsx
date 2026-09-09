import {useEffect,useState} from 'react';
import {Utensils,BookOpen,Plus,Scale,Camera,ChartNoAxesCombined,Compass,Settings as SettingsIcon} from 'lucide-react';
import {api,ApiError} from './lib/api';
import {readLocal} from './lib/local';
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

type Page='today'|'food'|'progress'|'coach'|'settings';

function Workspace({user,onLogout}:{user:string;onLogout:()=>Promise<void>}){
  const store=useNourish(user);
  const [page,setPage]=useState<Page>('today');
  const [date,setDate]=useState(today());
  const [foodOpen,setFoodOpen]=useState(false);
  const [foodDate,setFoodDate]=useState(today());
  const [foodInitialTime,setFoodInitialTime]=useState<string>();
  const [foodEditing,setFoodEditing]=useState<Entry>();
  const [foodInitialAi,setFoodInitialAi]=useState(false);
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
  const [conflictDetails,setConflictDetails]=useState(false);
  const [showAddSheet,setShowAddSheet]=useState(false);
  const [addReturnFocus,setAddReturnFocus]=useState<HTMLElement|null>(null);
  const needsProfile=!!store.state&&!store.state.profile;

  useEffect(()=>{if(needsProfile)setPage('coach');},[needsProfile]);
  useEffect(()=>{if(store.state?.profile){const current=today(store.state.profile.timeZone);setDate(current);setFoodDate(current);setWeightDate(current);setCopyDate(current);}},[store.state?.profile?.timeZone]);

  const openFood=(selectedDate:string,entry?:Entry,ai=false,restoreFocus?:HTMLElement|null,initialTime?:string)=>{
    setFoodDate(selectedDate);setFoodEditing(entry);setFoodInitialAi(ai);setFoodInitialTime(initialTime);setFoodReturnFocus(restoreFocus??null);setFoodOriginPage(page);setFoodOpen(true);
  };
  const openWeight=(selectedDate:string,entry?:Weight,restoreFocus?:HTMLElement|null)=>{
    setWeightDate(selectedDate);setWeightEditing(entry);setWeightReturnFocus(restoreFocus??null);setWeightOpen(true);
  };
  const openCopy=(sourceDate:string,entries:Entry[],restoreFocus?:HTMLElement|null)=>{
    setCopyDate(sourceDate);setCopyEntries(entries);setCopyReturnFocus(restoreFocus??null);setCopyOpen(true);
  };
  const activeDate=store.state?.profile?today(store.state.profile.timeZone):date;
  const selectedEntryDate=page==='today'?date:page==='food'?foodDate:activeDate;
  const addOptions:ActionSheetOption[]=[
    {id:'food',label:'Log food',description:'Choose a saved food or enter a meal.',icon:<Utensils size={20}/>,onClick:()=>openFood(selectedEntryDate,undefined,false,addReturnFocus)},
    {id:'weight',label:'Log weight',description:'Record today’s scale weight.',icon:<Scale size={20}/>,onClick:()=>openWeight(selectedEntryDate,undefined,addReturnFocus)},
    {id:'scan',label:'Scan food or label',description:'Use a meal photo or nutrition label.',icon:<Camera size={20}/>,onClick:()=>openFood(selectedEntryDate,undefined,true,addReturnFocus)},
  ];
  const navigate=(next:Page)=>{if(next===page)return;if(next==='food')setFoodDate(date);setPage(next);window.scrollTo({top:0,behavior:'instant'});};
  const foodSavedPage=foodOriginPage==='food'?'food':'today';
  const nav=[
    {id:'today',label:'Today',icon:Utensils},
    {id:'food',label:'Food Log',icon:BookOpen},
    {id:'progress',label:'Progress',icon:ChartNoAxesCombined},
    {id:'coach',label:'Coach',icon:Compass},
    {id:'settings',label:'Settings',icon:SettingsIcon},
  ] as const;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Nourish home"><Brand/>nourish</a>
      <nav aria-label="Main navigation">
        <SelectionIndicator active={page} className="nav-mobile-items nav-selection">
          <Button data-selection-key="today" disabled={needsProfile} variant="tertiary" className={page==='today'?'nav-active':''} aria-current={page==='today'?'page':undefined} onClick={()=>navigate('today')}><Utensils size={20}/><span>Today</span></Button>
          <Button data-selection-key="food" disabled={needsProfile} variant="tertiary" className={page==='food'?'nav-active':''} aria-current={page==='food'?'page':undefined} onClick={()=>navigate('food')}><BookOpen size={20}/><span>Food Log</span></Button>
          <Button data-selection-key="progress" disabled={needsProfile} variant="tertiary" className={page==='progress'?'nav-active':''} aria-current={page==='progress'?'page':undefined} onClick={()=>navigate('progress')}><ChartNoAxesCombined size={20}/><span>Progress</span></Button>
          <Button disabled={needsProfile} variant="primary" className="nav-center-add" aria-label="Add entry" onClick={event=>{setAddReturnFocus(event.currentTarget);setShowAddSheet(true);}}><Plus size={22} className="nav-icon"/><span>Add</span></Button>
          <Button data-selection-key="coach" variant="tertiary" className={page==='coach'?'nav-active':''} aria-current={page==='coach'?'page':undefined} onClick={()=>navigate('coach')}><Compass size={20}/><span>Coach</span></Button>
          <Button data-selection-key="settings" disabled={needsProfile} variant="tertiary" className={page==='settings'?'nav-active':''} aria-current={page==='settings'?'page':undefined} onClick={()=>navigate('settings')}><SettingsIcon size={20}/><span>Settings</span></Button>
        </SelectionIndicator>
        <SelectionIndicator active={page} className="nav-desktop-items nav-selection">
          <Button disabled={needsProfile} variant="primary" className="nav-add-desktop" onClick={event=>{setAddReturnFocus(event.currentTarget);setShowAddSheet(true);}}><Plus size={19}/><span>Add entry</span></Button>
          {nav.map(item=>{const Icon=item.icon;return <Button data-selection-key={item.id} key={item.id} disabled={needsProfile&&item.id!=='coach'} variant="tertiary" className={page===item.id?'nav-active':''} aria-current={page===item.id?'page':undefined} onClick={()=>navigate(item.id)}><Icon size={21}/><span>{item.label}</span></Button>;})}
        </SelectionIndicator>
      </nav>
    </aside>
    <main className="main-content">
      <div className="topbar"><span>{store.state?.username}</span>{needsProfile&&<Button variant="tertiary" onClick={()=>void onLogout()}>Sign out</Button>}{store.local?.queue.length?<span role="status">{store.local.queue.length} saved on this device</span>:null}</div>
      {store.error&&<div className="notice" role="status">{store.error}<Button variant="tertiary" onClick={()=>void store.drain()} disabled={store.busy}>Retry connection</Button></div>}
      {store.local?.queue.some(queue=>queue.error)&&<section className="notice"><h3>A saved edit needs review</h3><p>Copy any details you need, then discard the conflicting edit to use the server record.</p><Button onClick={()=>setConflictDetails(!conflictDetails)}>Review conflicting edits</Button>{conflictDetails&&store.local.queue.filter(queue=>queue.error).map(queue=><div key={queue.id}><p>{queue.error}</p><pre>{JSON.stringify(queue.data,null,2)}</pre><Button variant="destructive" onClick={()=>void store.discardConflict(queue.id)}>Discard this queued edit</Button></div>)}</section>}
      {!store.state?<section className="panel skeleton" aria-busy="true"><h1>Opening your diary…</h1><Button onClick={()=>void onLogout()}>Back to sign in</Button></section>:<MotionScene sceneKey={needsProfile?'coach':page}>
        {!needsProfile&&page==='today'?<Today store={store} date={date} setDate={setDate} onLog={()=>openFood(date)} onCoach={()=>navigate('coach')} onEdit={entry=>openFood(entry.date,entry)} onWeight={trigger=>openWeight(date,undefined,trigger)} onCopyDay={openCopy}/>:!needsProfile&&page==='food'?<FoodDiary store={store} date={foodDate} setDate={setFoodDate} onLog={time=>openFood(foodDate,undefined,false,null,time)} onEdit={entry=>openFood(entry.date,entry)} />:!needsProfile&&page==='progress'?<Progress store={store}/>:needsProfile||page==='coach'?<Coach store={store} onboarding={needsProfile}/>:<Settings store={store} onLogout={onLogout}/>}
      </MotionScene>}
      {store.state?.profile&&<MissedDays store={store}/>}
      {store.state&&<>
        <LogFood key={`${foodDate}:${foodEditing?.id??'new'}:${foodInitialAi?'scan':'food'}:${foodInitialTime??''}`} open={foodOpen} store={store} date={foodDate} editing={foodEditing} initialAi={foodInitialAi} initialTime={foodInitialTime} restoreFocus={foodReturnFocus} onClose={()=>{setFoodOpen(false);setPage(foodOriginPage);}} onSaved={()=>{setFoodOpen(false);setDate(foodDate);setFoodDate(foodDate);setPage(foodSavedPage);}}/>
        <WeightEntryDialog open={weightOpen} store={store} date={weightDate} initial={weightEditing} restoreFocus={weightReturnFocus} onClose={()=>setWeightOpen(false)}/>
        <CopyDayDialog open={copyOpen} store={store} sourceDate={copyDate} entries={copyEntries} restoreFocus={copyReturnFocus} onClose={()=>setCopyOpen(false)}/>
      </>}
    </main>
    <ActionSheet isOpen={showAddSheet} onClose={()=>setShowAddSheet(false)} restoreFocus={addReturnFocus} title="Add" subtitle="" options={addOptions}/>
  </div>;
}

export default function App(){
  const [user,setUser]=useState<string|null>();
  useEffect(()=>{
    const stopWatchingTheme=watchTheme();
    let active=true;
    void (async()=>{
      if(localStorage.getItem('nourish-signed-out')==='1'){setUser(null);return;}
      const previous=localStorage.getItem('nourish-account');let cached=false;
      try{cached=!!previous&&!!await readLocal(previous);}catch{/* Try the server if local storage is unavailable. */}
      if(active&&cached)setUser(previous);
      try{
        const account=await api<{id:string}>('/auth/me');
        if(active&&localStorage.getItem('nourish-signed-out')!=='1'){localStorage.setItem('nourish-account',account.id);setUser(account.id);}
      }catch(ex){if(active&&(!cached||(ex instanceof ApiError&&ex.status===401)))setUser(null);}
    })();
    return()=>{active=false;stopWatchingTheme();};
  },[]);
  const logout=async()=>{localStorage.setItem('nourish-signed-out','1');localStorage.removeItem('nourish-account');setUser(null);try{await api('/auth/logout',{});}catch{/* Explicit signed-out marker prevents an offline logout from reopening via an old cookie. */}};
  if(user===undefined)return <main className="startup"><Brand size={38}/></main>;
  return user?<Workspace key={user} user={user} onLogout={logout}/>:<Auth onLogin={id=>{localStorage.removeItem('nourish-signed-out');setUser(id);}}/>;
}

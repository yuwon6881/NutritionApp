import {useEffect,useState} from 'react';
import {Utensils,PlusCircle,Plus,Scale,Camera,ChartNoAxesCombined,Compass,Settings as SettingsIcon} from 'lucide-react';
import {api,ApiError} from './lib/api';
import {readLocal} from './lib/local';
import {today} from './lib/format';
import {watchTheme} from './lib/theme';
import {useNourish} from './useNourish';
import type {Entry} from './types';
import {Button} from './components/ui/Button';
import {Brand} from './components/ui/Brand';
import {ActionSheet, type ActionSheetOption} from './components/ui/ActionSheet';
import {Auth} from './components/Auth';
import {Today} from './components/Today';
import {LogFood} from './components/LogFood';
import {Progress} from './components/Progress';
import {Coach} from './components/Coach';
import {Settings} from './components/Settings';
import {MissedDays} from './components/MissedDays';
type Page='today'|'log'|'progress'|'coach'|'settings';
function Workspace({user,onLogout}:{user:string;onLogout:()=>Promise<void>}){
  const store=useNourish(user);
  const [page,setPage]=useState<Page>('today');
  const [date,setDate]=useState(today());
  const [aiLogging,setAiLogging]=useState(false);
  const [editing,setEditing]=useState<Entry>();
  const [conflictDetails,setConflictDetails]=useState(false);
  const [showAddSheet,setShowAddSheet]=useState(false);
  const [openWeightToday,setOpenWeightToday]=useState(false);
  const needsProfile=!!store.state&&!store.state.profile;
  useEffect(()=>{if(needsProfile)setPage('coach');},[needsProfile]);
  const nav=[{id:'today',label:'Today',icon:Utensils},{id:'log',label:'Log food',icon:PlusCircle},{id:'progress',label:'Progress',icon:ChartNoAxesCombined},{id:'coach',label:'Coach',icon:Compass},{id:'settings',label:'Settings',icon:SettingsIcon}] as const;
  const addOptions: ActionSheetOption[] = [
    {
      id: 'food',
      label: 'Log food',
      icon: <Utensils size={20} />,
      onClick: () => {
        setPage('log');
        setEditing(undefined);
        window.scrollTo({top: 0, behavior: 'instant'});
      },
    },
    {
      id: 'weight',
      label: 'Log weight',
      icon: <Scale size={20} />,
      onClick: () => {
        setOpenWeightToday(true);
        setPage('today');
        window.scrollTo({top: 0, behavior: 'instant'});
      },
    },
    {
      id: 'scan',
      label: 'Scan food or label',
      icon: <Camera size={20} />,
      onClick: () => {
        setAiLogging(true);setPage('log');
        setEditing(undefined);
        window.scrollTo({top: 0, behavior: 'instant'});
      },
    },
  ];
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Nourish home"><Brand/>nourish</a>
      <nav aria-label="Main navigation">
        {/* Mobile Bottom Navigation with Centered Add Button */}
        <div className="nav-mobile-items">
          <Button disabled={needsProfile} variant="tertiary" className={page==='today'?'nav-active':''} aria-current={page==='today'?'page':undefined} onClick={()=>{setPage('today');setEditing(undefined);window.scrollTo({top:0,behavior:'instant'});}}>
            <Utensils size={20}/><span>Today</span>
          </Button>
          <Button disabled={needsProfile} variant="tertiary" className={page==='progress'?'nav-active':''} aria-current={page==='progress'?'page':undefined} onClick={()=>{setPage('progress');setEditing(undefined);window.scrollTo({top:0,behavior:'instant'});}}>
            <ChartNoAxesCombined size={20}/><span>Progress</span>
          </Button>
          <Button disabled={needsProfile} variant="primary" className="nav-center-add" aria-label="Add entry" onClick={()=>setShowAddSheet(true)}>
            <Plus size={22} className="nav-icon"/><span>Add</span>
          </Button>
          <Button variant="tertiary" className={page==='coach'?'nav-active':''} aria-current={page==='coach'?'page':undefined} onClick={()=>{setPage('coach');setEditing(undefined);window.scrollTo({top:0,behavior:'instant'});}}>
            <Compass size={20}/><span>Coach</span>
          </Button>
          <Button disabled={needsProfile} variant="tertiary" className={page==='settings'?'nav-active':''} aria-current={page==='settings'?'page':undefined} onClick={()=>{setPage('settings');setEditing(undefined);window.scrollTo({top:0,behavior:'instant'});}}>
            <SettingsIcon size={20}/><span>Settings</span>
          </Button>
        </div>
        {/* Desktop Navigation */}
        <div className="nav-desktop-items">
          {nav.map(item=><Button key={item.id} disabled={needsProfile&&item.id!=='coach'} variant="tertiary" className={page===item.id?'nav-active':''} aria-current={page===item.id?'page':undefined} onClick={()=>{setPage(item.id);setEditing(undefined);window.scrollTo({top:0,behavior:'instant'});}}><item.icon size={21}/><span>{item.label}</span></Button>)}
        </div>
      </nav>
    </aside>
    <main className="main-content">
      <div className="topbar"><span>{store.state?.username}</span>{needsProfile&&<Button variant="tertiary" onClick={()=>void onLogout()}>Sign out</Button>}{store.local?.queue.length?<span role="status">{store.local.queue.length} saved on this device</span>:null}</div>
      {store.error&&<div className="notice" role="status">{store.error}<Button variant="tertiary" onClick={()=>void store.drain()} disabled={store.busy}>Retry connection</Button></div>}{store.local?.queue.some(q=>q.error)&&<section className="notice"><h3>A saved edit needs review</h3><p>Copy any details you need, then discard the conflicting edit to use the server record.</p><Button onClick={()=>setConflictDetails(!conflictDetails)}>Review conflicting edits</Button>{conflictDetails&&store.local.queue.filter(q=>q.error).map(q=><div key={q.id}><p>{q.error}</p><pre>{JSON.stringify(q.data,null,2)}</pre><Button variant="destructive" onClick={()=>void store.discardConflict(q.id)}>Discard this queued edit</Button></div>)}</section>}
      {!store.state?<section className="panel skeleton" aria-busy="true"><h1>Opening your diary…</h1><Button onClick={()=>void onLogout()}>Back to sign in</Button></section>:!needsProfile&&page==='today'?<Today store={store} date={date} setDate={setDate} openWeight={openWeightToday} onLog={()=>setPage('log')} onCoach={()=>setPage('coach')} onEdit={e=>{setEditing(e);setPage('log');}}/>:!needsProfile&&page==='log'?<LogFood initialAi={aiLogging} store={store} date={date} editing={editing} onDone={()=>{setAiLogging(false);setPage('today');setEditing(undefined);}}/>:!needsProfile&&page==='progress'?<Progress store={store}/>:(needsProfile||page==='coach')?<Coach store={store} onboarding={needsProfile}/>:<Settings store={store} onLogout={onLogout}/>}
      {store.state?.profile&&<MissedDays store={store}/>}
    </main>
    <ActionSheet
      isOpen={showAddSheet}
      onClose={() => setShowAddSheet(false)}
      title="Add"
      subtitle=""
      options={addOptions}
    />
  </div>;
}
export default function App(){
  const [user,setUser]=useState<string|null>();
  useEffect(()=>{
    // A device without a stored choice follows the browser, so a new account opens in the
    // appearance the browser is already using.
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
      }catch(ex){
        if(active&&(!cached||(ex instanceof ApiError&&ex.status===401)))setUser(null);
      }
    })();
    return()=>{active=false;stopWatchingTheme();};
  },[]);
  const logout=async()=>{localStorage.setItem('nourish-signed-out','1');localStorage.removeItem('nourish-account');setUser(null);try{await api('/auth/logout',{});}catch{/* Explicit signed-out marker prevents an offline logout from reopening via an old cookie. */}};
  if(user===undefined)return <main className="startup"><Brand size={38}/></main>;
  return user?<Workspace key={user} user={user} onLogout={logout}/>:<Auth onLogin={id=>{localStorage.removeItem('nourish-signed-out');setUser(id);}}/>;
}

import {useEffect,useState} from 'react';
import {Sprout,Utensils,PlusCircle,Plus,Scale,Camera,ChartNoAxesCombined,Compass,Settings as SettingsIcon,RefreshCw} from 'lucide-react';
import {api,ApiError} from './lib/api';
import {readLocal} from './lib/local';
import {today} from './lib/format';
import {useNourish} from './useNourish';
import type {Entry} from './types';
import {Button} from './components/ui/Button';
import {ActionSheet, type ActionSheetOption} from './components/ui/ActionSheet';
import {Auth} from './components/Auth';
import {Today} from './components/Today';
import {LogFood} from './components/LogFood';
import {Progress} from './components/Progress';
import {Coach} from './components/Coach';
import {Settings} from './components/Settings';
type Page='today'|'log'|'progress'|'coach'|'settings';
function Workspace({user,onLogout}:{user:string;onLogout:()=>Promise<void>}){
  const store=useNourish(user);
  const [page,setPage]=useState<Page>('today');
  const [date,setDate]=useState(today());
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
      description: 'Search foods, use saved recipes, or quick calorie entry',
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
      description: 'Record today’s scale weigh-in and track trend',
      icon: <Scale size={20} />,
      onClick: () => {
        setOpenWeightToday(true);
        setPage('today');
        window.scrollTo({top: 0, behavior: 'instant'});
      },
    },
    {
      id: 'scan',
      label: 'Scan or describe meal',
      description: 'Use AI to estimate nutrition from photo or text',
      icon: <Camera size={20} />,
      onClick: () => {
        setPage('log');
        setEditing(undefined);
        window.scrollTo({top: 0, behavior: 'instant'});
      },
    },
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Nourish home"><Sprout/>nourish<span className="brand-dot">•</span></a>
      <p className="sidebar-caption">A little better understood.</p>
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
      <div className="sidebar-note"><Sprout size={24}/><p>Consistency, not perfection.</p><small>Your coach learns from what you log, without judging your choices.</small></div>
    </aside>
    <main className="main-content">
      <div className="topbar"><span>YOUR EVERYDAY NUTRITION COMPANION</span>{needsProfile&&<Button variant="tertiary" onClick={()=>void onLogout()}>Sign out</Button>}<Button variant="tertiary" onClick={()=>void store.drain()} disabled={store.busy}><RefreshCw size={14}/>{store.busy?'Syncing':store.local?.queue.length?`${store.local.queue.length} pending`:'Sync'}</Button></div>
      {store.error&&<div className="notice" role="status">{store.error}</div>}{store.local?.queue.some(q=>q.error)&&<section className="notice"><h3>A saved edit needs review</h3><p>Your local changes are retained. Copy any needed details, then discard the conflicting edit to use the server record and edit it again.</p><Button onClick={()=>setConflictDetails(!conflictDetails)}>Review conflicting edits</Button>{conflictDetails&&store.local.queue.filter(q=>q.error).map(q=><div key={q.id}><p>{q.error}</p><pre>{JSON.stringify(q.data,null,2)}</pre><Button variant="destructive" onClick={()=>void store.discardConflict(q.id)}>Discard this queued edit</Button></div>)}</section>}
      {!store.state?<section className="panel skeleton" aria-busy="true"><h1>Opening your diary…</h1><p>Loading saved data from this device and the service.</p><Button onClick={()=>void onLogout()}>Back to sign in</Button></section>:!needsProfile&&page==='today'?<Today store={store} date={date} setDate={setDate} openWeight={openWeightToday} onLog={()=>setPage('log')} onCoach={()=>setPage('coach')} onEdit={e=>{setEditing(e);setPage('log');}}/>:!needsProfile&&page==='log'?<LogFood store={store} date={date} editing={editing} onDone={()=>{setPage('today');setEditing(undefined);}}/>:!needsProfile&&page==='progress'?<Progress store={store}/>:(needsProfile||page==='coach')?<Coach store={store} onboarding={needsProfile}/>:<Settings store={store} onLogout={onLogout}/>}
      <footer>Made for steady progress. Research-informed, always reviewable.</footer>
    </main>

    <ActionSheet
      isOpen={showAddSheet}
      onClose={() => setShowAddSheet(false)}
      title="What would you like to add?"
      subtitle="Choose an entry type to update your diary"
      options={addOptions}
    />
  </div>;
}
export default function App(){
  const [user,setUser]=useState<string|null>();
  useEffect(()=>{document.documentElement.dataset.theme=localStorage.getItem('nourish-theme')??'light';if(localStorage.getItem('nourish-signed-out')==='1'){setUser(null);return;}void api<{id:string}>('/auth/me').then(u=>{localStorage.setItem('nourish-account',u.id);setUser(u.id);}).catch(async ex=>{const previous=localStorage.getItem('nourish-account');try{if(!(ex instanceof ApiError)&&previous&&await readLocal(previous))setUser(previous);else setUser(null);}catch{setUser(null);}});},[]);
  const logout=async()=>{localStorage.setItem('nourish-signed-out','1');localStorage.removeItem('nourish-account');setUser(null);try{await api('/auth/logout',{});}catch{/* Explicit signed-out marker prevents an offline logout from reopening via an old cookie. */}};
  if(user===undefined)return <main className="startup"><Sprout size={38}/><p>Opening Nourish…</p></main>;
  return user?<Workspace key={user} user={user} onLogout={logout}/>:<Auth onLogin={id=>{localStorage.removeItem('nourish-signed-out');setUser(id);}}/>;
}


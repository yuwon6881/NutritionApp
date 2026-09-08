import {useEffect,useState} from 'react';
import {Sprout,Utensils,PlusCircle,ChartNoAxesCombined,Compass,Settings as SettingsIcon,RefreshCw} from 'lucide-react';
import {api,ApiError} from './lib/api';
import {readLocal} from './lib/local';
import {today} from './lib/format';
import {useNourish} from './useNourish';
import type {Entry} from './types';
import {Button} from './components/ui/Button';
import {Auth} from './components/Auth';
import {Today} from './components/Today';
import {LogFood} from './components/LogFood';
import {Progress} from './components/Progress';
import {Coach} from './components/Coach';
import {Settings} from './components/Settings';
type Page='today'|'log'|'progress'|'coach'|'settings';
function Workspace({user,onLogout}:{user:string;onLogout:()=>Promise<void>}){
  const store=useNourish(user);const [page,setPage]=useState<Page>('today');const [date,setDate]=useState(today());const [editing,setEditing]=useState<Entry>();const [conflictDetails,setConflictDetails]=useState(false);
  const needsProfile=!!store.state&&!store.state.profile;
  useEffect(()=>{if(needsProfile)setPage('coach');},[needsProfile]);
  const nav=[{id:'today',label:'Today',icon:Utensils},{id:'log',label:'Log food',icon:PlusCircle},{id:'progress',label:'Progress',icon:ChartNoAxesCombined},{id:'coach',label:'Coach',icon:Compass},{id:'settings',label:'Settings',icon:SettingsIcon}] as const;
  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="/" aria-label="Nourish home"><Sprout/>nourish<span className="brand-dot">•</span></a><p className="sidebar-caption">A little better understood.</p><nav aria-label="Main navigation">{nav.map(item=><Button key={item.id} disabled={needsProfile&&item.id!=='coach'} variant="tertiary" className={page===item.id?'nav-active':''} aria-current={page===item.id?'page':undefined} onClick={()=>{setPage(item.id);setEditing(undefined);window.scrollTo({top:0,behavior:'instant'});}}><item.icon size={21}/><span>{item.label}</span></Button>)}</nav><div className="sidebar-note"><Sprout size={24}/><p>Consistency, not perfection.</p><small>Your coach learns from what you log, without judging your choices.</small></div></aside><main className="main-content"><div className="topbar"><span>YOUR EVERYDAY NUTRITION COMPANION</span>{needsProfile&&<Button variant="tertiary" onClick={()=>void onLogout()}>Sign out</Button>}<Button variant="tertiary" onClick={()=>void store.drain()} disabled={store.busy}><RefreshCw size={14}/>{store.busy?'Syncing':store.local?.queue.length?`${store.local.queue.length} pending`:'Sync'}</Button></div>
    {store.error&&<div className="notice" role="status">{store.error}</div>}{store.local?.queue.some(q=>q.error)&&<section className="notice"><h3>A saved edit needs review</h3><p>Your local changes are retained. Copy any needed details, then discard the conflicting edit to use the server record and edit it again.</p><Button onClick={()=>setConflictDetails(!conflictDetails)}>Review conflicting edits</Button>{conflictDetails&&store.local.queue.filter(q=>q.error).map(q=><div key={q.id}><p>{q.error}</p><pre>{JSON.stringify(q.data,null,2)}</pre><Button variant="destructive" onClick={()=>void store.discardConflict(q.id)}>Discard this queued edit</Button></div>)}</section>}
    {!store.state?<section className="panel skeleton" aria-busy="true"><h1>Opening your diary…</h1><p>Loading saved data from this device and the service.</p><Button onClick={()=>void onLogout()}>Back to sign in</Button></section>:!needsProfile&&page==='today'?<Today store={store} date={date} setDate={setDate} onLog={()=>setPage('log')} onCoach={()=>setPage('coach')} onEdit={e=>{setEditing(e);setPage('log');}}/>:!needsProfile&&page==='log'?<LogFood store={store} date={date} editing={editing} onDone={()=>{setPage('today');setEditing(undefined);}}/>:!needsProfile&&page==='progress'?<Progress store={store}/>:(needsProfile||page==='coach')?<Coach store={store} onboarding={needsProfile}/>:<Settings store={store} onLogout={onLogout}/>}
    <footer>Made for steady progress. Research-informed, always reviewable.</footer></main></div>;
}
export default function App(){
  const [user,setUser]=useState<string|null>();
  useEffect(()=>{document.documentElement.dataset.theme=localStorage.getItem('nourish-theme')??'light';if(localStorage.getItem('nourish-signed-out')==='1'){setUser(null);return;}void api<{id:string}>('/auth/me').then(u=>{localStorage.setItem('nourish-account',u.id);setUser(u.id);}).catch(async ex=>{const previous=localStorage.getItem('nourish-account');try{if(!(ex instanceof ApiError)&&previous&&await readLocal(previous))setUser(previous);else setUser(null);}catch{setUser(null);}});},[]);
  const logout=async()=>{localStorage.setItem('nourish-signed-out','1');localStorage.removeItem('nourish-account');setUser(null);try{await api('/auth/logout',{});}catch{/* Explicit signed-out marker prevents an offline logout from reopening via an old cookie. */}};
  if(user===undefined)return <main className="startup"><Sprout size={38}/><p>Opening Nourish…</p></main>;
  return user?<Workspace key={user} user={user} onLogout={logout}/>:<Auth onLogin={id=>{localStorage.removeItem('nourish-signed-out');setUser(id);}}/>;
}


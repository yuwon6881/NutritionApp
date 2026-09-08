import {useEffect,useState} from 'react';
import type {Nourish} from '../useNourish';
import {api} from '../lib/api';
import {wipeLocal} from '../lib/local';
import {number} from '../lib/format';
import {activeTheme,browserTheme,chooseTheme,storedTheme,type Theme} from '../lib/theme';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
export function Settings({store,onLogout}:{store:Nourish;onLogout:()=>Promise<void>}){
  const [storage,setStorage]=useState<{databaseBytes:number;pendingImageBytes:number;warning:boolean;optionalWritesBlocked:boolean}>();const [error,setError]=useState('');const [current,setCurrent]=useState('');const [password,setPassword]=useState('');const [wipe,setWipe]=useState('');const [theme,setTheme]=useState(storedTheme()??'system');const [busy,setBusy]=useState(false);
  useEffect(()=>{void api<typeof storage>('/storage').then(setStorage).catch(ex=>setError(ex.message));},[]);
  const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(ex){setError((ex as Error).message);}finally{setBusy(false);}};
  return <><header className="page-heading"><div><h1>Settings</h1><p>{store.state!.username}</p></div><Button onClick={()=>void action(onLogout)}>Sign out</Button></header>
  <section className="panel"><h2>Preferences</h2><SelectField label="Appearance" value={theme} onChange={v=>{
    setTheme(v);
    if(v==='system'){try{localStorage.removeItem('nourish-theme');}catch{/* The applied theme still holds for this session. */}chooseTheme(browserTheme());}
    else chooseTheme(v as Theme);
  }}><option value="system">Match browser · {activeTheme()==='dark'?'Ayu Dark':'Ayu Light'}</option><option value="light">Ayu Light</option><option value="dark">Ayu Dark</option></SelectField><p>Kilograms, centimetres, grams, kilocalories · {store.state!.profile?.timeZone??'Asia/Kuala_Lumpur'}</p></section>
  <section className="panel"><h2>Storage</h2>{storage?<><div className="stats-grid"><div><p>Database</p><h2>{number(storage.databaseBytes/1_000_000,1)} <span className="unit">MB</span></h2></div><div><p>Temporary scan images</p><h2>{number(storage.pendingImageBytes/1_000_000,1)} <span className="unit">MB</span></h2></div></div>{storage.warning&&<p className="notice">Database usage is approaching the free-tier budget.</p>}{storage.optionalWritesBlocked&&<p className="error">Optional storage growth is paused.</p>}</>:<p>Connect to view storage usage.</p>}<p>Meal details stay for {store.state!.detailDays??7} days, then become daily totals. Weights and accepted plans remain.</p><Button disabled={busy||store.local!.queue.length>0} onClick={()=>void action(async()=>{const response=await fetch('/api/export',{credentials:'same-origin'});if(!response.ok)throw new Error('Export failed. Please sign in and retry.');const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='nourish-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})}>Download my nutrition history</Button></section>
  <section className="panel"><h2>Change your password</h2><form onSubmit={e=>{e.preventDefault();void action(async()=>{await api('/auth/password',{currentPassword:current,newPassword:password});await onLogout();});}}><Field label="Current password" type="password" autoComplete="current-password" required value={current} onChange={e=>setCurrent(e.target.value)}/><Field label="New password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}/><Button disabled={busy} type="submit">Change password and sign out all devices</Button></form></section>
  <section className="panel"><h2>Local data on this device</h2><p>Wiping removes this account’s local cache, pending edits, and scan drafts. Server records remain.</p><Field label="Type WIPE to remove local data" value={wipe} onChange={e=>setWipe(e.target.value)}/><Button variant="destructive" disabled={wipe!=='WIPE'||busy} onClick={()=>void action(async()=>{await onLogout();await wipeLocal(store.state!.id);})}>Wipe this account’s local data</Button></section>{error&&<p className="error" role="alert">{error}</p>}</>;
}

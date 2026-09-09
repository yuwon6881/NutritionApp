import {Form} from './ui/Form';
import {useState} from 'react';
import type {Nourish} from '../useNourish';
import {api} from '../lib/api';
import {chooseTheme,storedTheme,type Theme} from '../lib/theme';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {CoachingSettings} from './CoachingSettings';

export function Settings({store,onLogout}:{store:Nourish;onLogout:()=>Promise<void>}){
  const [error,setError]=useState('');const [current,setCurrent]=useState('');const [password,setPassword]=useState('');const [theme,setTheme]=useState<Theme>(storedTheme()??'light');const [busy,setBusy]=useState(false);
  const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(ex){setError((ex as Error).message);}finally{setBusy(false);}};
  return <><header className="page-heading"><div><h1 data-page-heading tabIndex={-1}>Settings</h1><p>{store.state!.username}</p></div><Button onClick={()=>void action(onLogout)}>Sign out</Button></header>
  <section className="panel"><h2>Preferences</h2><SelectField id="settings-theme" name="theme" label="Appearance" value={theme} onChange={v=>{const next=v as Theme;setTheme(next);chooseTheme(next);}}><option value="light">Light</option><option value="dark">Dark</option></SelectField><p>Kilograms, centimetres, grams, kilocalories · {store.state!.profile?.timeZone??'Asia/Kuala_Lumpur'}</p></section>
  {store.state!.profile&&<CoachingSettings store={store}/>}
  <section className="panel"><h2>Change your password</h2><Form onSubmit={e=>{e.preventDefault();void action(async()=>{await api('/auth/password',{currentPassword:current,newPassword:password});await onLogout();});}}><Field id="settings-current-password" name="currentPassword" validate={()=>error==='Current password is incorrect.'?error:undefined} label="Current password" type="password" autoComplete="current-password" required value={current} onChange={e=>{setCurrent(e.target.value);setError('');}}/><Field id="settings-new-password" name="newPassword" label="New password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}/><Button disabled={busy} type="submit">Change password and sign out all devices</Button></Form></section>
  {error&&error!=='Current password is incorrect.'&&<p className="error" role="alert">{error}</p>}</>;
}

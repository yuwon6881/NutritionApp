import {useState} from 'react';
import {Bell,Compass,HardDrive,Link2,LogOut,SlidersHorizontal} from 'lucide-react';
import type {Nourish} from '../useNourish';
import {chooseTheme,storedTheme,type Theme} from '../lib/theme';
import {Button} from './ui/Button';
import {CardFeedback} from './ui/CardFeedback';
import {GoogleHealthSettings} from './GoogleHealthSettings';
import {ConnectedApps} from './ConnectedApps';
import {NotificationsSettings} from './NotificationsSettings';
import {LocalDataSettings} from './LocalDataSettings';
import {DiarySettings,GeneralSettings,useSettingsSave} from './SettingsPreferences';
import {SettingsNav,SettingsSection,type SettingsSectionLink} from './SettingsLayout';

const sections:SettingsSectionLink[]=[
  {id:'settings-general',label:'General',icon:SlidersHorizontal},
  {id:'settings-diary',label:'Diary & coaching',icon:Compass},
  {id:'settings-notifications',label:'Notifications',icon:Bell},
  {id:'settings-connections',label:'Connected Apps',icon:Link2},
  {id:'settings-device',label:'This device',icon:HardDrive}
];

function initials(name:string){
  const words=name.trim().split(/[\s._-]+/).filter(Boolean);
  return (words.length>1?words[0][0]+words[1][0]:name.trim().slice(0,2)).toUpperCase()||'?';
}

export function Settings({store,onLogout}:{store:Nourish;onLogout:()=>Promise<void>}){
  const [error,setError]=useState('');
  const [theme,setTheme]=useState<Theme>(storedTheme()??'light');
  const {saving,needsReview,savingLabel}=useSettingsSave(store);
  const state=store.state!;

  const signOut=()=>void (async()=>{
    setError('');
    try{await onLogout();}catch(ex){setError((ex as Error).message);}
  })();
  const changeTheme=(next:Theme)=>{setTheme(next);chooseTheme(next);};
  const [general,diary,notifications,connections,device]=sections;

  return <div className="settings-page">
    <header className="page-heading settings-heading">
      <h1 data-page-heading tabIndex={-1}>Settings</h1>
      {saving&&<p className="settings-save-status" role="status"><span className="settings-save-indicator" aria-hidden="true"/><span><strong>{savingLabel}</strong><small>Changes are saved automatically.</small></span></p>}
    </header>
    {needsReview&&<CardFeedback tone="warning" title="Settings need review" message="This settings change is waiting for review in the saved edit notice above."/>}

    <section className="panel settings-account" aria-labelledby="account-title">
      <span className="settings-avatar" aria-hidden="true">{initials(state.displayName)}</span>
      <div className="settings-account-copy">
        <h2 id="account-title">Fitness Account</h2>
        <strong className="settings-account-name">{state.displayName}</strong>
        <p>Sign-in, password, and security are managed by Fitness Account.</p>
      </div>
      <Button variant="secondary" onClick={signOut}><LogOut size={16} aria-hidden="true"/>Sign out</Button>
    </section>
    {error&&<CardFeedback title="Settings action failed" message={error}/>}

    <div className="settings-shell">
      <SettingsNav links={sections}/>
      <div className="settings-sections">
        <SettingsSection {...general} title="General" description="Units apply across your diary, charts, and coach.">
          <GeneralSettings store={store} theme={theme} onTheme={changeTheme}/>
        </SettingsSection>
        <SettingsSection {...diary} title="Diary & coaching" description="How past days resolve and when your weekly check-in is due.">
          <DiarySettings store={store}/>
        </SettingsSection>
        <SettingsSection {...notifications} title="Notifications" description="Optional weekly reminders. Notification text stays general and never includes food, weight, or account details.">
          <NotificationsSettings store={store}/>
        </SettingsSection>
        <SettingsSection {...connections} layout="plain" title="Connected Apps" description="Connected services add context. They never change your calorie or macro targets.">
          <GoogleHealthSettings/>
          <ConnectedApps store={store}/>
        </SettingsSection>
        <SettingsSection {...device} title="This device" description="Data kept in this browser for offline use.">
          <LocalDataSettings accountId={state.id} onLogout={onLogout}/>
        </SettingsSection>
      </div>
    </div>
  </div>;
}

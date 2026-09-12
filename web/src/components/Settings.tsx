import {Form} from './ui/Form';
import {useState} from 'react';
import type {Nourish} from '../useNourish';
import {api} from '../lib/api';
import {chooseTheme,storedTheme,type Theme} from '../lib/theme';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {CoachingSettings,UnitPreferencesFields} from './CoachingSettings';
import {unitsFor} from '../lib/units';
import type {CoachingSettings as CoachingSettingsType,MissingDayAction,UnitPreferences} from '../types';
import {useAsyncAction} from './ui/useAsyncAction';
import {DataExport} from './DataExport';

export function Settings({store,onLogout}:{store:Nourish;onLogout:()=>Promise<void>}){
  const [error,setError]=useState('');
  const [current,setCurrent]=useState('');
  const [password,setPassword]=useState('');
  const [theme,setTheme]=useState<Theme>(storedTheme()??'light');
  const {busy,run}=useAsyncAction();

  const state=store.state!;
  const settings=state.settings??{checkInWeekday:1,revision:0};
  const units=unitsFor(settings);

  const queued=store.local?.queue.find(operation=>operation.kind==='settings');
  const savedSettings=store.local?.state.settings;
  const saved={
    checkInWeekday:savedSettings?.checkInWeekday??1,
    weightUnit:savedSettings?.weightUnit??'kg',
    energyUnit:savedSettings?.energyUnit??'kcal',
    heightUnit:savedSettings?.heightUnit??'cm',
    missingDayAction:savedSettings?.missingDayAction??'ask'
  } as const;
  const queuedData=queued?.data as Partial<CoachingSettingsType>|undefined;
  const changes=queued&&!queued.error?[
    queuedData?.checkInWeekday!==undefined&&queuedData.checkInWeekday!==saved.checkInWeekday?'check-in day':null,
    queuedData?.weightUnit!==undefined&&queuedData.weightUnit!==saved.weightUnit||queuedData?.energyUnit!==undefined&&queuedData.energyUnit!==saved.energyUnit||queuedData?.heightUnit!==undefined&&queuedData.heightUnit!==saved.heightUnit?'unit preferences':null,
    queuedData?.missingDayAction!==undefined&&queuedData.missingDayAction!==saved.missingDayAction?'unlogged day preference':null
  ].filter((value):value is string=>value!==null):[];
  const savingLabel=changes.length===1?`Saving your ${changes[0]}...`:changes.length>1?`Saving your ${changes.join(' and ')}...`:'Saving your coaching settings...';
  const settingsSaving=Boolean(queued&&!queued.error);

  const updateUnits=(patch:Partial<UnitPreferences>)=>{
    const next={...units,...patch};
    void store.mutate({
      kind:'settings',
      recordId:state.id,
      expectedRevision:settings.revision,
      data:{checkInWeekday:settings.checkInWeekday,weightUnit:next.weight,energyUnit:next.energy,heightUnit:next.height,missingDayAction:settings.missingDayAction??'ask'},
      delete:false
    });
  };

  const updateMissingDayAction=(value:MissingDayAction)=>{
    void store.mutate({
      kind:'settings',
      recordId:state.id,
      expectedRevision:settings.revision,
      data:{checkInWeekday:settings.checkInWeekday,weightUnit:units.weight,energyUnit:units.energy,heightUnit:units.height,missingDayAction:value},
      delete:false
    });
  };

  const action=async(fn:()=>Promise<void>)=>{
    setError('');
    try{await run(fn);}catch(ex){setError((ex as Error).message);}
  };

  return <>
    <header className="page-heading">
      <div>
        <h1 data-page-heading tabIndex={-1}>Settings</h1>
        <p>{state.username}</p>
      </div>
      <Button variant="secondary" onClick={()=>void action(onLogout)}>Sign out</Button>
    </header>

    {settingsSaving&&<p className="notice settings-save-status" role="status"><span className="settings-save-indicator" aria-hidden="true"/><span><strong>{savingLabel}</strong><small>Changes are saved automatically.</small></span></p>}
    {queued?.error&&<p className="error settings-error" role="alert">This settings change is waiting for review in the saved edit notice above.</p>}

    <div className="settings-grid">
      <div className="settings-column">
        <section className="panel" aria-labelledby="preferences-title">
          <h2 id="preferences-title">Preferences</h2>
          <SelectField id="settings-theme" name="theme" label="Appearance" value={theme} onChange={v=>{const next=v as Theme;setTheme(next);chooseTheme(next);}}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </SelectField>
          <UnitPreferencesFields value={units} onChange={updateUnits} asFieldset={false}>
            <SelectField id="settings-missing-day-action" name="missingDayAction" label="Unlogged days" value={settings.missingDayAction??'ask'} onChange={v=>updateMissingDayAction(v as MissingDayAction)}>
              <option value="ask">Ask each time</option>
              <option value="fasting">Default to fasting</option>
              <option value="not_logged">Default to not logging</option>
            </SelectField>
          </UnitPreferencesFields>
          <p className="source">Units apply across your diary, charts, and coach. Profile time zone: {state.profile?.timeZone??'Asia/Kuala_Lumpur'}.</p>
        </section>
        {state.profile&&<CoachingSettings store={store} hideUnits hideSaveStatus/>}
      </div>

      <div className="settings-column">
        <section className="panel" aria-labelledby="password-title">
          <h2 id="password-title">Change your password</h2>
          <Form onSubmit={e=>{e.preventDefault();void action(async()=>{await api('/auth/password',{currentPassword:current,newPassword:password});await onLogout();});}}>
            <Field id="settings-current-password" name="currentPassword" validate={()=>error==='Current password is incorrect.'?error:undefined} label="Current password" type="password" autoComplete="current-password" required value={current} onChange={e=>{setCurrent(e.target.value);setError('');}}/>
            <Field id="settings-new-password" name="newPassword" label="New password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}/>
            <div className="actions">
              <Button disabled={busy} type="submit">Change password and sign out all devices</Button>
            </div>
          </Form>
        </section>
        <DataExport store={store}/>
      </div>
    </div>

    {error&&error!=='Current password is incorrect.'&&<p className="error" role="alert">{error}</p>}
  </>;
}

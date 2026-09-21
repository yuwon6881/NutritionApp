import {useState} from 'react';
import type {Nourish} from '../useNourish';
import {chooseTheme,storedTheme,type Theme} from '../lib/theme';
import {clearUserCache,countAccountLocalWork,type AccountLocalWorkCounts} from '../lib/local';
import {Button} from './ui/Button';
import {SelectField} from './ui/Field';
import {CoachingSettings,UnitPreferencesFields} from './CoachingSettings';
import {unitsFor} from '../lib/units';
import type {CoachingSettings as CoachingSettingsType,MissingDayAction,UnitPreferences,WeightGoalMetric} from '../types';
import {useAsyncAction} from './ui/useAsyncAction';
import {GoogleHealthSettings} from './GoogleHealthSettings';
import {ConnectedApps} from './ConnectedApps';
import {CardFeedback} from './ui/CardFeedback';
import {PwaReadiness} from './ui/MobilePwa';
import {NotificationsSettings} from './NotificationsSettings';
import {Modal} from './ui/Modal';

export function Settings({store,onLogout}:{store:Nourish;onLogout:()=>Promise<void>}){
  const [error,setError]=useState('');
  const [theme,setTheme]=useState<Theme>(storedTheme()??'light');
  const [localRemovalOpen,setLocalRemovalOpen]=useState(false);
  const [localRemovalCounts,setLocalRemovalCounts]=useState<AccountLocalWorkCounts>();
  const [localRemovalNotice,setLocalRemovalNotice]=useState('');
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
    missingDayAction:savedSettings?.missingDayAction??'ask',
    weightGoalMetric:savedSettings?.weightGoalMetric??'scale'
  } as const;
  const queuedData=queued?.data as Partial<CoachingSettingsType>|undefined;
  const changes=queued&&!queued.error?[
    queuedData?.checkInWeekday!==undefined&&queuedData.checkInWeekday!==saved.checkInWeekday?'check-in day':null,
    queuedData?.weightUnit!==undefined&&queuedData.weightUnit!==saved.weightUnit||queuedData?.energyUnit!==undefined&&queuedData.energyUnit!==saved.energyUnit||queuedData?.heightUnit!==undefined&&queuedData.heightUnit!==saved.heightUnit?'unit preferences':null,
    queuedData?.missingDayAction!==undefined&&queuedData.missingDayAction!==saved.missingDayAction?'unlogged day preference':null,
    queuedData?.weightGoalMetric!==undefined&&queuedData.weightGoalMetric!==saved.weightGoalMetric?'weight goal basis':null
  ].filter((value):value is string=>value!==null):[];
  const savingLabel=changes.length===1?`Saving your ${changes[0]}...`:changes.length>1?`Saving your ${changes.join(' and ')}...`:'Saving your coaching settings...';
  const settingsSaving=Boolean(queued&&!queued.error);

  const updateUnits=(patch:Partial<UnitPreferences>)=>{
    const next={...units,...patch};
    void store.mutate({
      kind:'settings',
      recordId:state.id,
      expectedRevision:settings.revision,
      data:{checkInWeekday:settings.checkInWeekday,weightUnit:next.weight,energyUnit:next.energy,heightUnit:next.height,missingDayAction:settings.missingDayAction??'ask',weightGoalMetric:settings.weightGoalMetric??'scale'},
      delete:false
    });
  };

  const updateMissingDayAction=(value:MissingDayAction)=>{
    void store.mutate({
      kind:'settings',
      recordId:state.id,
      expectedRevision:settings.revision,
      data:{checkInWeekday:settings.checkInWeekday,weightUnit:units.weight,energyUnit:units.energy,heightUnit:units.height,missingDayAction:value,weightGoalMetric:settings.weightGoalMetric??'scale'},
      delete:false
    });
  };

  const updateWeightGoalMetric=(value:WeightGoalMetric)=>{
    void store.mutate({
      kind:'settings',
      recordId:state.id,
      expectedRevision:settings.revision,
      data:{checkInWeekday:settings.checkInWeekday,weightUnit:units.weight,energyUnit:units.energy,heightUnit:units.height,missingDayAction:settings.missingDayAction??'ask',weightGoalMetric:value},
      delete:false
    });
  };

  const action=async(fn:()=>Promise<void>)=>{
    setError('');
    try{await run(fn);}catch(ex){setError((ex as Error).message);}
  };

  const reviewLocalRemoval=()=>void action(async()=>{
    setLocalRemovalNotice('');
    setLocalRemovalCounts(await countAccountLocalWork(state.id));
    setLocalRemovalOpen(true);
  });

  const confirmLocalRemoval=()=>void (async()=>{
    setLocalRemovalNotice('');
    try{
      await run(async()=>{
        const current=await countAccountLocalWork(state.id);
        if(!localRemovalCounts||Object.keys(current).some(key=>current[key as keyof AccountLocalWorkCounts]!==localRemovalCounts[key as keyof AccountLocalWorkCounts])){
          setLocalRemovalCounts(current);
          setLocalRemovalNotice('The pending-work count changed. Review the updated count and confirm again to remove it.');
          return;
        }
        await clearUserCache(state.id);
        await onLogout();
        // A foreground sync may finish while the existing logout path revokes push
        // credentials. Remove any cache it restored before this flow returns.
        await clearUserCache(state.id);
      });
    }catch(ex){
      setLocalRemovalNotice(`Local data could not be fully removed. ${((ex as Error).message??'Please try again.')}`);
    }
  });

  return <>
    <header className="page-heading">
      <div>
        <h1 data-page-heading tabIndex={-1}>Settings</h1>
        <p>{state.displayName}</p>
      </div>
      <Button variant="secondary" onClick={()=>void action(onLogout)}>Sign out</Button>
    </header>

    {settingsSaving&&<p className="notice settings-save-status" role="status"><span className="settings-save-indicator" aria-hidden="true"/><span><strong>{savingLabel}</strong><small>Changes are saved automatically.</small></span></p>}
    {queued?.error&&<CardFeedback tone="warning" title="Settings need review" message="This settings change is waiting for review in the saved edit notice above."/>}

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
            <SelectField id="settings-weight-goal-metric" name="weightGoalMetric" label="Weight goal basis" value={settings.weightGoalMetric??'scale'} onChange={v=>updateWeightGoalMetric(v as WeightGoalMetric)}>
              <option value="scale">Scale weight</option>
              <option value="trend">Trend weight</option>
            </SelectField>
          </UnitPreferencesFields>
          <p className="source">Units apply app-wide. Time zone: {state.profile?.timeZone??'Asia/Kuala_Lumpur'}.</p>
        </section>
        {state.profile&&<CoachingSettings store={store} hideUnits hideSaveStatus/>}
      </div>

      <div className="settings-column">
        <section className="panel" aria-labelledby="account-title">
          <h2 id="account-title">Fitness Account</h2>
          <p className="source">Credentials and security managed centrally by Fitness Account.</p>
        </section>
        <GoogleHealthSettings/>
        <ConnectedApps store={store}/>
        <PwaReadiness store={store}/>
        <NotificationsSettings store={store}/>
        <section className="panel" aria-labelledby="local-data-title">
          <h2 id="local-data-title">Local Nutrition data</h2>
          <p className="source">Remove this account&apos;s Nutrition cache and device-only work from this browser. Your server-synced Nutrition records remain in your account.</p>
          <Button variant="destructive" disabled={busy} onClick={reviewLocalRemoval}>Remove local data…</Button>
        </section>
      </div>
    </div>

    {error&&<CardFeedback title="Settings action failed" message={error}/>}
    <Modal open={localRemovalOpen} onClose={()=>{if(!busy)setLocalRemovalOpen(false);}} title="Remove local Nutrition data?" description="This removes Nutrition data for this account from this browser and signs you out." width="sm" preventDismiss={busy}>
      <div>
        <p>Device-only pending work will be removed. Server-synced Nutrition data stays in your account. Other accounts and notification revocation work on this device are kept.</p>
        {localRemovalCounts&&<>
          <p><strong>Pending work on this device: {localRemovalCounts.total}</strong></p>
          <ul>
            <li>Outbox changes: {localRemovalCounts.outboxMutations}</li>
            <li>Body drafts: {localRemovalCounts.bodyDrafts}</li>
            <li>Photo drafts: {localRemovalCounts.photoDrafts}</li>
            <li>Food basket drafts: {localRemovalCounts.foodBasketDrafts}</li>
            <li>Food scan drafts: {localRemovalCounts.scanDrafts}</li>
          </ul>
        </>}
        {localRemovalNotice&&<p className="notice" role="status">{localRemovalNotice}</p>}
        <div className="actions">
          <Button variant="secondary" disabled={busy} onClick={()=>setLocalRemovalOpen(false)}>Keep local data</Button>
          <Button variant="destructive" disabled={busy||!localRemovalCounts} onClick={confirmLocalRemoval}>{busy?'Removing…':'Remove local data & sign out'}</Button>
        </div>
      </div>
    </Modal>
  </>;
}

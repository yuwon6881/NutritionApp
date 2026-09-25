import {useMemo} from 'react';
import {Moon,Sun} from 'lucide-react';
import type {Nourish} from '../useNourish';
import {nextOccurrenceAfter} from '../lib/checkIn';
import {longDate,today} from '../lib/format';
import {unitsFor} from '../lib/units';
import type {Theme} from '../lib/theme';
import type {CoachingSettings,EnergyUnit,HeightUnit,MissingDayAction,WeightGoalMetric,WeightUnit} from '../types';
import {SelectField} from './ui/Field';
import {SegmentedControl} from './ui/SegmentedControl';
import {SettingRow} from './ui/SettingRow';

type SettingsData=Required<Omit<CoachingSettings,'revision'|'changedDate'>>;

const weekdays=[
  ['1','Monday'],['2','Tuesday'],['3','Wednesday'],['4','Thursday'],['5','Friday'],['6','Saturday'],['0','Sunday']
] as const;

/** One settings mutation path: every change sends the whole preference record at the current revision. */
export function useSettingsSave(store:Nourish){
  const state=store.state!;
  const settings=state.settings??{checkInWeekday:1,revision:0};
  const units=unitsFor(settings);
  const current:SettingsData={
    checkInWeekday:settings.checkInWeekday,
    weightUnit:units.weight,
    energyUnit:units.energy,
    heightUnit:units.height,
    missingDayAction:settings.missingDayAction??'ask',
    weightGoalMetric:settings.weightGoalMetric??'scale'
  };
  const save=(patch:Partial<SettingsData>)=>store.mutate({kind:'settings',recordId:state.id,expectedRevision:settings.revision,data:{...current,...patch},delete:false});

  const queued=store.local?.queue.find(operation=>operation.kind==='settings');
  const saved=store.local?.state.settings;
  const queuedData=queued?.data as Partial<CoachingSettings>|undefined;
  const differs=<K extends keyof SettingsData>(key:K,fallback:SettingsData[K])=>queuedData?.[key]!==undefined&&queuedData[key]!==(saved?.[key]??fallback);
  const changes=queued&&!queued.error?[
    differs('checkInWeekday',1)?'check-in day':null,
    differs('weightUnit','kg')||differs('energyUnit','kcal')||differs('heightUnit','cm')?'unit preferences':null,
    differs('missingDayAction','ask')?'unlogged day preference':null,
    differs('weightGoalMetric','scale')?'weight goal basis':null
  ].filter((value):value is string=>value!==null):[];
  const savingLabel=changes.length?`Saving your ${changes.join(' and ')}...`:'Saving your coaching settings...';
  return {current,save,saving:Boolean(queued&&!queued.error),needsReview:Boolean(queued?.error),savingLabel};
}

export function GeneralSettings({store,theme,onTheme}:{store:Nourish;theme:Theme;onTheme:(theme:Theme)=>void}){
  const {current,save}=useSettingsSave(store);
  return <>
    <SettingRow label="Appearance" description="Applies to this device.">
      <SegmentedControl id="settings-theme" label="Appearance" className="settings-choice" value={theme} onChange={onTheme} options={[
        {value:'light',label:<><Sun size={15} aria-hidden="true"/>Light</>},
        {value:'dark',label:<><Moon size={15} aria-hidden="true"/>Dark</>}
      ]}/>
    </SettingRow>
    <SettingRow label="Weight" description="Scale entries, goals, and weight charts.">
      <SegmentedControl<WeightUnit> id="settings-weight-unit" label="Weight unit" className="settings-choice" value={current.weightUnit} onChange={weightUnit=>void save({weightUnit})} options={[
        {value:'kg',label:'kg',ariaLabel:'Kilograms (kg)'},{value:'lb',label:'lb',ariaLabel:'Pounds (lb)'}
      ]}/>
    </SettingRow>
    <SettingRow label="Energy" description="Calorie targets, diary totals, and expenditure.">
      <SegmentedControl<EnergyUnit> id="settings-energy-unit" label="Energy unit" className="settings-choice" value={current.energyUnit} onChange={energyUnit=>void save({energyUnit})} options={[
        {value:'kcal',label:'kcal',ariaLabel:'Kilocalories (kcal)'},{value:'kj',label:'kJ',ariaLabel:'Kilojoules (kJ)'}
      ]}/>
    </SettingRow>
    <SettingRow label="Height" description="Profile and body measurements.">
      <SegmentedControl<HeightUnit> id="settings-height-unit" label="Height unit" className="settings-choice" value={current.heightUnit} onChange={heightUnit=>void save({heightUnit})} options={[
        {value:'cm',label:'cm',ariaLabel:'Centimetres (cm)'},{value:'ft-in',label:'ft · in',ariaLabel:'Feet and inches'}
      ]}/>
    </SettingRow>
  </>;
}

const missingDayDescriptions:Record<MissingDayAction,string>={
  ask:'You decide each past day with no food logged.',
  fasting:'Past days with no food count as fasting unless you choose otherwise.',
  not_logged:'Past days with no food count as not logged; they are left out of intake-based calibration.'
};

export function DiarySettings({store}:{store:Nourish}){
  const state=store.state!;
  const {current,save}=useSettingsSave(store);
  const date=today(state.profile?.timeZone);
  const next=useMemo(()=>nextOccurrenceAfter(date,current.checkInWeekday),[date,current.checkInWeekday]);
  return <>
    <SettingRow label="Unlogged days" description={missingDayDescriptions[current.missingDayAction]}>
      <SegmentedControl<MissingDayAction> id="settings-missing-day-action" label="Unlogged days" className="settings-choice" value={current.missingDayAction} onChange={missingDayAction=>void save({missingDayAction})} options={[
        {value:'ask',label:'Ask'},{value:'fasting',label:'Fasting'},{value:'not_logged',label:'Not logging',ariaLabel:'Not logging'}
      ]}/>
    </SettingRow>
    <SettingRow label="Weight goal basis" description={current.weightGoalMetric==='trend'?'Progress follows your smoothed trend weight.':'Progress follows your latest scale entry.'}>
      <SegmentedControl<WeightGoalMetric> id="settings-weight-goal-metric" label="Weight goal basis" className="settings-choice" value={current.weightGoalMetric} onChange={weightGoalMetric=>void save({weightGoalMetric})} options={[
        {value:'scale',label:'Scale'},{value:'trend',label:'Trend'}
      ]}/>
    </SettingRow>
    {state.profile&&<SettingRow label="Check-in day" description={<>Next check-in <strong>{longDate(next)}</strong>. Changing the day keeps the active plan in place.</>}>
      <SelectField id="coaching-check-in-weekday" name="checkInWeekday" label="Check-in weekday" value={String(current.checkInWeekday)} onChange={value=>void save({checkInWeekday:Number(value)})}>
        {weekdays.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </SelectField>
    </SettingRow>}
  </>;
}

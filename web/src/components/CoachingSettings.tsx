import {useMemo} from 'react';
import type {Nourish} from '../useNourish';
import {nextOccurrenceAfter} from '../lib/checkIn';
import {today} from '../lib/format';
import {SelectField} from './ui/Field';
import type {CoachingSettings,EnergyUnit,HeightUnit,UnitPreferences,WeightUnit} from '../types';
import {defaultUnits,unitsFor} from '../lib/units';

const days=[
  ['1','Monday'],['2','Tuesday'],['3','Wednesday'],['4','Thursday'],['5','Friday'],['6','Saturday'],['0','Sunday']
] as const;

export function CoachingSettings({store}:{store:Nourish}){
  const state=store.state!;
  const settings=state.settings??{checkInWeekday:1,revision:0};
  const units=unitsFor(settings);
  const queued=store.local?.queue.find(operation=>operation.kind==='settings');
  const savedSettings=store.local?.state.settings;
  const saved={
    checkInWeekday:savedSettings?.checkInWeekday??1,
    weightUnit:savedSettings?.weightUnit??'kg',
    energyUnit:savedSettings?.energyUnit??'kcal',
    heightUnit:savedSettings?.heightUnit??'cm'
  } as const;
  const queuedData=queued?.data as Partial<CoachingSettings>|undefined;
  const changes=queued&&!queued.error?[
    queuedData?.checkInWeekday!==undefined&&queuedData.checkInWeekday!==saved.checkInWeekday?'check-in day':null,
    queuedData?.weightUnit!==undefined&&queuedData.weightUnit!==saved.weightUnit||queuedData?.energyUnit!==undefined&&queuedData.energyUnit!==saved.energyUnit||queuedData?.heightUnit!==undefined&&queuedData.heightUnit!==saved.heightUnit?'unit preferences':null
  ].filter((value):value is string=>value!==null):[];
  const savingLabel=changes.length===1?`Saving your ${changes[0]}...`:changes.length>1?`Saving your ${changes.join(' and ')}...`:'Saving your coaching settings...';
  const current=today(state.profile?.timeZone);
  const next=useMemo(()=>nextOccurrenceAfter(current,settings.checkInWeekday),[current,settings.checkInWeekday]);
  const update=async(value:string)=>{
    const weekday=Number(value);
    await store.mutate({kind:'settings',recordId:state.id,expectedRevision:settings.revision,data:{checkInWeekday:weekday,weightUnit:units.weight,energyUnit:units.energy,heightUnit:units.height},delete:false});
  };
  const updateUnits=(patch:Partial<UnitPreferences>)=>{
    const next={...units,...patch};
    void store.mutate({kind:'settings',recordId:state.id,expectedRevision:settings.revision,data:{checkInWeekday:settings.checkInWeekday,weightUnit:next.weight,energyUnit:next.energy,heightUnit:next.height},delete:false});
  };
  return <section className="panel coaching-settings" aria-labelledby="coaching-settings-title">
    <h2 id="coaching-settings-title">Coaching cadence</h2>
    <SelectField id="coaching-check-in-weekday" name="checkInWeekday" label="Check-in weekday" value={String(settings.checkInWeekday)} onChange={value=>void update(value)}>
      {days.map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </SelectField>
    <p className="source">The active plan stays in place. Your next check-in is {next}.</p>
    <UnitPreferencesFields value={units} onChange={updateUnits}/>
    {queued&&!queued.error&&<p className="notice settings-save-status" role="status"><span className="settings-save-indicator" aria-hidden="true"/><span><strong>{savingLabel}</strong><small>Changes are saved automatically.</small></span></p>}
    {queued?.error&&<p className="error settings-error" role="alert">This settings change is waiting for review in the saved edit notice above.</p>}
  </section>;
}

export function UnitPreferencesFields({value=defaultUnits,onChange,compact=false}:{value?:UnitPreferences;onChange:(patch:Partial<UnitPreferences>)=>void;compact?:boolean}){
  return <fieldset className={`unit-preferences${compact?' compact':''}`}>
    <legend>Units</legend>
    <p className="source">Units apply across your diary, charts, and coach.</p>
    <div className="form-grid">
      <SelectField id="settings-weight-unit" name="weightUnit" label="Weight" value={value.weight} onChange={v=>onChange({weight:v as WeightUnit})}>
        <option value="kg">Kilograms (kg)</option><option value="lb">Pounds (lb)</option>
      </SelectField>
      <SelectField id="settings-energy-unit" name="energyUnit" label="Energy" value={value.energy} onChange={v=>onChange({energy:v as EnergyUnit})}>
        <option value="kcal">Kilocalories (kcal)</option><option value="kj">Kilojoules (kJ)</option>
      </SelectField>
      <SelectField id="settings-height-unit" name="heightUnit" label="Height" value={value.height} onChange={v=>onChange({height:v as HeightUnit})}>
        <option value="cm">Centimetres (cm)</option><option value="ft-in">Feet / inches</option>
      </SelectField>
    </div>
  </fieldset>;
}

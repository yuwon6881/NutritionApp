import {useMemo} from 'react';
import type {Nourish} from '../useNourish';
import {nextOccurrenceAfter} from '../lib/checkIn';
import {today} from '../lib/format';
import {SelectField} from './ui/Field';

const days=[
  ['1','Monday'],['2','Tuesday'],['3','Wednesday'],['4','Thursday'],['5','Friday'],['6','Saturday'],['0','Sunday']
] as const;

export function CoachingSettings({store}:{store:Nourish}){
  const state=store.state!;
  const settings=state.settings??{checkInWeekday:1,revision:0};
  const queued=store.local?.queue.find(operation=>operation.kind==='settings');
  const current=today(state.profile?.timeZone);
  const next=useMemo(()=>nextOccurrenceAfter(current,settings.checkInWeekday),[current,settings.checkInWeekday]);
  const update=async(value:string)=>{
    const weekday=Number(value);
    await store.mutate({kind:'settings',recordId:state.id,expectedRevision:settings.revision,data:{checkInWeekday:weekday},delete:false});
  };
  return <section className="panel coaching-settings" aria-labelledby="coaching-settings-title">
    <h2 id="coaching-settings-title">Coaching cadence</h2>
    <SelectField id="coaching-check-in-weekday" name="checkInWeekday" label="Check-in weekday" value={String(settings.checkInWeekday)} onChange={value=>void update(value)}>
      {days.map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </SelectField>
    <p className="source">The active plan stays in place. Your next check-in is {next}.</p>
    {queued&&!queued.error&&<p className="notice" role="status">Saving your check-in day…</p>}
    {queued?.error&&<p className="error" role="alert">{queued.error} Your change is retained for review.</p>}
  </section>;
}

import type {Nourish} from '../useNourish';
import {longDate,today} from '../lib/format';
import {checkInSchedule,checkInWindowEvidence} from '../lib/checkIn';
import {CheckInButton} from './CheckInButton';

const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;

export function CheckInCard({store,onReview}:{store:Nourish;onReview:(trigger:HTMLElement)=>void}){
  const state=store.state!;
  const current=today(state.profile?.timeZone);
  if(!state.profile)return null;
  const schedule=checkInSchedule(state,current);
  const evidence=checkInWindowEvidence(state,current);
  return <section className={`panel check-in-card ${schedule.due?'is-ready':'is-waiting'}`} aria-labelledby="check-in-card-title">
    <CheckInButton schedule={schedule} label="Review this week" onClick={onReview}/>
    <div className="check-in-copy">
      <h2 id="check-in-card-title">{schedule.due?'Check-in ready':'Next check-in'}</h2>
      <p className="source">{schedule.due
        ?`${evidence.loggedDays} of 28 days logged · ${plural(evidence.weighIns,'weigh-in')}`
        :longDate(schedule.nextDate)}</p>
    </div>
  </section>;
}

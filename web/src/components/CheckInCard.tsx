import type {Nourish} from '../useNourish';
import {today} from '../lib/format';
import {checkInSchedule,checkInWindowEvidence} from '../lib/checkIn';
import {CheckInButton} from './CheckInButton';

export function CheckInCard({store,onReview}:{store:Nourish;onReview:(trigger:HTMLElement)=>void}){
  const state=store.state!;
  const current=today(state.profile?.timeZone);
  if(!state.profile)return null;
  const schedule=checkInSchedule(state,current);
  const evidence=checkInWindowEvidence(state,current);
  const dateLabel=new Intl.DateTimeFormat('en',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${schedule.nextDate}T00:00:00Z`));
  return <section className={`panel check-in-card ${schedule.due?'is-ready':'is-waiting'}`} aria-labelledby="check-in-card-title">
    <CheckInButton schedule={schedule} label="Review this week" onClick={onReview}/>
    <div className="check-in-copy">
      <p className="eyebrow">COACHING CADENCE</p>
      <h2 id="check-in-card-title">{schedule.due?'Your weekly check-in is ready':'Next check-in'}</h2>
      <p className="source">{schedule.due
        ?`${evidence.loggedDays} of 28 days logged · ${evidence.weighIns} weigh-ins`
        :`${schedule.daysUntil===1?'1 day':`${schedule.daysUntil} days`} until check-in · ${dateLabel}`}</p>
    </div>
  </section>;
}

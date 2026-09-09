import {CalendarCheck} from 'lucide-react';
import type {Nourish} from '../useNourish';
import {today} from '../lib/format';
import {checkInDue,checkInWindowEvidence} from '../lib/checkIn';
import {Button} from './ui/Button';

export function CheckInCard({store,onReview}:{store:Nourish;onReview:(trigger:HTMLElement)=>void}){
  const state=store.state!;
  const current=today(state.profile?.timeZone);
  if(!state.profile||!checkInDue(state,current))return null;
  const evidence=checkInWindowEvidence(state,current);
  return <section className="panel check-in-card" aria-labelledby="check-in-card-title">
    <div className="check-in-mark" aria-hidden="true"><CalendarCheck size={20}/></div>
    <div className="check-in-copy">
      <h2 id="check-in-card-title">Your weekly check-in is ready</h2>
      <p className="source">{evidence.loggedDays} of 28 days logged · {evidence.weighIns} weigh-ins</p>
    </div>
    <Button variant="primary" size="md" onClick={event=>onReview(event.currentTarget)}>Review this week</Button>
  </section>;
}

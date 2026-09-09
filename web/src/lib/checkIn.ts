import type {AppState} from '../types';

const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);

export function weekStart(date:string){
  const day=new Date(`${date}T00:00:00Z`).getUTCDay();
  return shift(date,-((day+6)%7));
}

export function periodStart(date:string,weekday=1){
  const day=new Date(`${date}T00:00:00Z`).getUTCDay();
  return shift(date,-((day-weekday+7)%7));
}

export function nextOccurrence(date:string,weekday:number){
  const day=new Date(`${date}T00:00:00Z`).getUTCDay();
  return shift(date,(weekday-day+7)%7);
}

export function nextOccurrenceAfter(date:string,weekday:number){
  const next=nextOccurrence(date,weekday);
  return next>date?next:shift(next,7);
}

export function checkInDue(state:Pick<AppState,'plans'|'profileRevision'|'checkIns'|'settings'>,current:string){
  const plans=state.plans.filter(plan=>!plan.deleted).sort((a,b)=>b.revision-a.revision);
  const last=plans[0];
  if(!last)return true;
  if(last.profileRevision!==state.profileRevision)return true;
  const weekday=state.settings?.checkInWeekday??1;
  const cadenceChanged=(last.coachingSettingsRevision??0)!==(state.settings?.revision??0)||last.checkInWeekday!=null&&last.checkInWeekday!==weekday;
  if(cadenceChanged){
    const next=nextOccurrenceAfter(state.settings?.changedDate??last.date,weekday);
    if(current<next)return false;
  }
  const currentPeriod=periodStart(current,weekday);
  const declined=(state.checkIns??[]).some(checkIn=>!checkIn.deleted&&checkIn.weekStart===currentPeriod&&(checkIn.checkInWeekday??1)===weekday&&checkIn.decision==='declined');
  return periodStart(current,weekday)>periodStart(last.date,weekday)&&!declined;
}

export function checkInWindowEvidence(state:Pick<AppState,'days'|'entries'|'weights'>,current:string){
  const start=shift(current,-28);
  const logged=new Set<string>();
  const days=new Map(state.days.filter(day=>!day.deleted).map(day=>[day.date,day]));
  for(const day of state.days){
    if(day.deleted||day.date<start||day.date>=current)continue;
    if(day.status==='complete'||day.status==='fasting')logged.add(day.date);
  }
  for(const entry of state.entries){
    if(entry.deleted||entry.date<start||entry.date>=current)continue;
    if(days.get(entry.date)?.status==='not_logged')continue;
    logged.add(entry.date);
  }
  const weighIns=state.weights.filter(weight=>!weight.deleted&&weight.date>=start&&weight.date<current).length;
  return {loggedDays:logged.size,weighIns};
}

export {weekStart as mondayWeekStart};

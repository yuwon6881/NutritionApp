import {shiftDate} from './energyBalance';

export interface WeekStripDay {
  date:string;
  weekday:string;
  dayOfMonth:number;
  future:boolean;
}

const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function weekdayIndex(date:string){
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** The Monday-to-Sunday week containing `selected`; days after `today` are marked so they can be disabled. */
export function weekStripDays(selected:string,today:string):WeekStripDay[]{
  const monday=shiftDate(selected,-((weekdayIndex(selected)+6)%7));
  return Array.from({length:7},(_,offset)=>{
    const date=shiftDate(monday,offset);
    return {date,weekday:WEEKDAYS[weekdayIndex(date)],dayOfMonth:Number(date.slice(8,10)),future:date>today};
  });
}

/** Swiping toward earlier days moves back one day; never past today or the diary's first date. */
export function swipedDate(date:string,direction:-1|1,today:string,earliest='2000-01-01'){
  const next=shiftDate(date,direction);
  return next>today||next<earliest?date:next;
}

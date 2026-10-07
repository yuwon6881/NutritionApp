import type {AppState} from '../types';

/**
 * Per-day logging status for the Dashboard habit calendars. Days outside the
 * range held on this device are `unknown`, never "not logged": the device
 * only stores a bounded window, and absence there proves nothing.
 */
export type FoodCalendarStatus='logged'|'fasting'|'not_logged'|'open'|'missing'|'before'|'unknown'|'future';
export type WeightCalendarStatus='logged'|'missing'|'before'|'unknown'|'future';

export interface CalendarCell<S extends string> {
  date:string;
  status:S;
}

export interface CalendarSummary {
  /** Days with a recorded habit (food logged or a weigh-in). */
  logged:number;
  /** Known past-or-today days the summary counts over. */
  known:number;
  /** Consecutive logged days ending today (or yesterday while today is still open). */
  streak:number;
}

const DAY_MS=86400000;

export function shiftIsoDate(date:string,days:number){
  return new Date(Date.parse(`${date}T00:00:00Z`)+days*DAY_MS).toISOString().slice(0,10);
}

/** Monday-based weekday index (0 = Monday) for an ISO date. */
export function weekdayIndex(date:string){
  return (new Date(`${date}T00:00:00Z`).getUTCDay()+6)%7;
}

/** Dates from `end - (days - 1)` through `end`, oldest first. */
export function calendarDates(end:string,days:number){
  return Array.from({length:days},(_,index)=>shiftIsoDate(end,index-days+1));
}

function held(state:AppState,date:string){
  return date>=state.start&&date<=state.end;
}

/** Earliest date in the list, or undefined when it is empty. */
function earliest(dates:string[]){
  return dates.reduce<string|undefined>((first,date)=>first===undefined||date<first?date:first,undefined);
}

/**
 * Days before a habit's first record are `before`, not missed: the device
 * holds a fixed window, so a new account would otherwise start with weeks of
 * apparent gaps.
 */
export function foodCalendar(state:AppState,current:string,end:string,days:number):CalendarCell<FoodCalendarStatus>[]{
  const foodDates=new Set(state.entries.filter(entry=>!entry.deleted).map(entry=>entry.date));
  const dayRecords=new Map(state.days.filter(day=>!day.deleted).map(day=>[day.date,day]));
  const first=earliest([...foodDates,...dayRecords.keys()]);
  return calendarDates(end,days).map(date=>{
    if(date>current)return {date,status:'future'};
    if(!held(state,date))return {date,status:'unknown'};
    const day=dayRecords.get(date);
    const hasFood=day?.archived?(day.entryCount??0)>0:foodDates.has(date);
    if(hasFood)return {date,status:'logged'};
    if(day?.status==='fasting')return {date,status:'fasting'};
    if(day?.status==='not_logged')return {date,status:'not_logged'};
    // Today stays open until it ends; it is not yet a missed day.
    if(date===current)return {date,status:'open'};
    return {date,status:first!==undefined&&date>first?'missing':'before'};
  });
}

export function weightCalendar(state:AppState,current:string,end:string,days:number):CalendarCell<WeightCalendarStatus>[]{
  const weighed=new Set(state.weights.filter(weight=>!weight.deleted).map(weight=>weight.date));
  const first=earliest([...weighed,...(state.weightTrendSeed??[]).filter(weight=>!weight.deleted).map(weight=>weight.date)]);
  return calendarDates(end,days).map(date=>{
    if(date>current)return {date,status:'future'};
    if(weighed.has(date))return {date,status:'logged'};
    if(!held(state,date))return {date,status:'unknown'};
    return {date,status:first!==undefined&&date>first?'missing':'before'};
  });
}

export interface CalendarMonth {
  /** `YYYY-MM`. */
  month:string;
  /** Empty cells before the 1st so it falls under its Monday-based weekday. */
  leading:number;
  dates:string[];
}

/** Whole calendar months from the month of `start` through the month of `end`, newest first. */
export function calendarMonths(start:string,end:string):CalendarMonth[]{
  const months:CalendarMonth[]=[];
  for(let month=start.slice(0,7);month<=end.slice(0,7);){
    const first=`${month}-01`;
    const [year,monthNumber]=month.split('-').map(Number);
    const length=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
    months.push({month,leading:weekdayIndex(first),dates:Array.from({length},(_,index)=>shiftIsoDate(first,index))});
    month=shiftIsoDate(first,length).slice(0,7);
  }
  return months.reverse();
}

/**
 * A fasting day is an explicit record of the day, so it counts as kept; an
 * explicit not-logging day does not. Today only counts once it has a record.
 */
const kept=(status:string)=>status==='logged'||status==='fasting';

export interface WeekSummary {
  /** Days kept this week, Monday through today. */
  kept:number;
  /** The whole week the count is read against. */
  days:7;
}

/** Kept days in the Monday-based week holding today, read against all seven days. */
export function summarizeWeek(cells:CalendarCell<string>[],current:string):WeekSummary{
  const monday=shiftIsoDate(current,-weekdayIndex(current));
  return {kept:cells.filter(cell=>cell.date>=monday&&cell.date<=current&&kept(cell.status)).length,days:7};
}

export function summarizeCalendar(cells:CalendarCell<string>[],current:string):CalendarSummary{
  const counted=(status:string)=>status!=='unknown'&&status!=='future'&&status!=='before';
  const known=cells.filter(cell=>counted(cell.status)&&!(cell.date===current&&!kept(cell.status)));
  let streak=0;
  for(let index=cells.length-1;index>=0;index--){
    const cell=cells[index];
    if(cell.status==='future')continue;
    if(cell.date===current&&!kept(cell.status))continue;
    if(!kept(cell.status))break;
    streak++;
  }
  return {logged:known.filter(cell=>kept(cell.status)).length,known:known.length,streak};
}

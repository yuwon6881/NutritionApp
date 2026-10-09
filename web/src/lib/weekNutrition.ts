import type {AppState,Day,Entry} from '../types';
import {calendarTarget} from './calendarProgress';
import {planForDate,targetsForDate} from './dailyTargets';
import {shiftIsoDate,weekdayIndex} from './loggingCalendar';

export type WeekNutrient='calories'|'protein'|'carbs'|'fat';
export const WEEK_NUTRIENTS:readonly WeekNutrient[]=['calories','protein','carbs','fat'];

type Amounts=Record<WeekNutrient,number|null>;

/**
 * `known` days carry intake evidence (food, a fasting day, or today so far); `missing` past
 * days have no food and no fasting decision, so their intake stays unknown rather than zero.
 * `unknown` days are outside the range this device holds; `future` days have not happened.
 */
export type WeekDayStatus='known'|'missing'|'unknown'|'future';

export interface WeekDay {
  date:string;
  status:WeekDayStatus;
  intake:Amounts;
  /** Some entries lack this nutrient, so the sum is a lower bound. */
  partial:Record<WeekNutrient,boolean>;
  target:Amounts;
}

export interface WeekAverage {
  /** Past days of this week with intake evidence; today is still open and is left out. */
  days:number;
  intake:Amounts;
  target:Amounts;
}

const none=():Amounts=>({calories:null,protein:null,carbs:null,fat:null});
const flags=()=>({calories:false,protein:false,carbs:false,fat:false});

function dayIntake(entries:Entry[],day:Day|undefined){
  const intake=none(),partial=flags();
  if(day?.archived){
    for(const key of WEEK_NUTRIENTS)intake[key]=day[key]??null;
    return {intake,partial,evidence:(day.entryCount??0)>0||day.status==='fasting'};
  }
  if(!entries.length){
    if(day?.status!=='fasting')return {intake,partial,evidence:false};
    for(const key of WEEK_NUTRIENTS)intake[key]=0;
    return {intake,partial,evidence:true};
  }
  intake.calories=entries.reduce((sum,entry)=>sum+entry.calories,0);
  for(const key of ['protein','carbs','fat'] as const){
    const known=entries.filter(entry=>entry[key]!=null);
    intake[key]=known.length?known.reduce((sum,entry)=>sum+entry[key]!,0):null;
    partial[key]=known.length>0&&known.length<entries.length;
  }
  return {intake,partial,evidence:true};
}

/** A date's accepted targets, or nothing before the first accepted plan. */
function dayTargets(state:AppState,date:string):Amounts{
  if(calendarTarget(state,date)==null)return none();
  return targetsForDate(planForDate(state,date),date);
}

/**
 * The Monday-based week holding `current`, with each day's logged intake against its targets.
 * While a check-in is due, calorie targets from `targetsPendingFrom` on may change, so they stay
 * unknown, as on the Dashboard energy card; macro targets stay shown, as on its macro card.
 */
export function weekNutrition(state:AppState,current:string,targetsPendingFrom?:string):WeekDay[]{
  const monday=shiftIsoDate(current,-weekdayIndex(current));
  const entries=state.entries.filter(entry=>!entry.deleted);
  const days=state.days.filter(day=>!day.deleted);
  return Array.from({length:7},(_,index)=>{
    const date=shiftIsoDate(monday,index);
    const target=dayTargets(state,date);
    if(targetsPendingFrom&&date>=targetsPendingFrom)target.calories=null;
    if(date>current)return {date,status:'future',intake:none(),partial:flags(),target};
    if(date<state.start||date>state.end)return {date,status:'unknown',intake:none(),partial:flags(),target};
    const {intake,partial,evidence}=dayIntake(entries.filter(entry=>entry.date===date),days.find(day=>day.date===date));
    // Today is still open: nothing logged yet is a known zero, not a missed day.
    if(!evidence&&date===current)return {date,status:'known',intake:{calories:0,protein:0,carbs:0,fat:0},partial,target};
    return {date,status:evidence?'known':'missing',intake,partial,target};
  });
}

/** Average intake and target over this week's past days with intake evidence. */
export function weekAverage(week:WeekDay[],current:string):WeekAverage{
  const counted=week.filter(day=>day.status==='known'&&day.date<current);
  const mean=(values:(number|null)[])=>{
    const known=values.filter((value):value is number=>value!=null);
    return known.length===values.length&&known.length?known.reduce((sum,value)=>sum+value,0)/known.length:null;
  };
  const intake=none(),target=none();
  for(const key of WEEK_NUTRIENTS){
    intake[key]=mean(counted.map(day=>day.intake[key]));
    target[key]=mean(counted.map(day=>day.target[key]));
  }
  return {days:counted.length,intake,target};
}

/** Share of a target reached, capped at one; null when either side is unknown. */
export function targetShare(intake:number|null,target:number|null):number|null{
  if(intake==null||target==null||!Number.isFinite(intake)||!Number.isFinite(target)||target<=0)return null;
  return Math.max(0,Math.min(intake/target,1));
}

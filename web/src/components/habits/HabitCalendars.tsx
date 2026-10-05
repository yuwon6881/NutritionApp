import {useMemo} from 'react';
import type {AppState} from '../../types';
import {foodCalendar,shiftIsoDate,summarizeCalendar,weekdayIndex,weightCalendar,type FoodCalendarStatus,type WeightCalendarStatus} from '../../lib/loggingCalendar';
import {HabitCalendarCard,type HabitLegendItem} from './HabitCalendarCard';

/** Four whole weeks ending this Sunday keep the compact grid aligned to weekdays. */
const RECENT_WEEKS=4;

const FOOD_LABELS:Record<FoodCalendarStatus,string>={
  logged:'Food logged',
  fasting:'Fasting day',
  not_logged:'Marked as not logging',
  open:'Today, nothing logged yet',
  missing:'Nothing logged',
  before:'Before your first log',
  unknown:'Not stored on this device',
  future:'Upcoming',
};

const WEIGHT_LABELS:Record<WeightCalendarStatus,string>={
  logged:'Weighed in',
  missing:'No weigh-in',
  before:'Before your first weigh-in',
  unknown:'Not stored on this device',
  future:'Upcoming',
};

const FOOD_LEGEND:HabitLegendItem[]=[
  {status:'logged',label:'Logged'},
  {status:'fasting',label:'Fasting'},
  {status:'not_logged',label:'Not logging'},
  {status:'missing',label:'Nothing logged'},
  {status:'unknown',label:'Not on this device'},
];

const WEIGHT_LEGEND:HabitLegendItem[]=[
  {status:'logged',label:'Weighed in'},
  {status:'missing',label:'No weigh-in'},
  {status:'unknown',label:'Not on this device'},
];

export function HabitCalendars({state,current}:{state:AppState;current:string}){
  const calendars=useMemo(()=>{
    const weekEnd=shiftIsoDate(current,6-weekdayIndex(current));
    const recentDays=RECENT_WEEKS*7;
    const historyDays=Math.max(1,Math.round((Date.parse(current)-Date.parse(state.start))/86400000)+1);
    const food=foodCalendar(state,current,current,historyDays);
    const weight=weightCalendar(state,current,current,historyDays);
    return {
      food:{recent:foodCalendar(state,current,weekEnd,recentDays),history:food,summary:summarizeCalendar(food,current)},
      weight:{recent:weightCalendar(state,current,weekEnd,recentDays),history:weight,summary:summarizeCalendar(weight,current)},
    };
  },[state,current]);
  return <div className="habit-calendars">
    <HabitCalendarCard title="Food logging" tone="food" current={current} legend={FOOD_LEGEND}
      describe={status=>FOOD_LABELS[status as FoodCalendarStatus]??status} {...calendars.food}/>
    <HabitCalendarCard title="Weigh-ins" tone="weight" current={current} legend={WEIGHT_LEGEND}
      describe={status=>WEIGHT_LABELS[status as WeightCalendarStatus]??status} {...calendars.weight}/>
  </div>;
}

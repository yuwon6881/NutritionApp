import type {Entry} from '../types';
import {lineKey,type BasketLine} from './foodBasket';

/**
 * Recent and frequent foods for one-tap re-logging. Each food is represented
 * by its most recent entry, so re-logging repeats the last portion eaten.
 * Ranking favours foods eaten often in the last four weeks, eaten recently,
 * and usually eaten around the current time of day.
 */
export const RECENT_WINDOW_DAYS=28;
const TIME_AFFINITY_MINUTES=120;

export interface RecentFoodContext {
  /** Today in the profile time zone, YYYY-MM-DD. */
  date:string;
  /** Minutes since local midnight now. */
  minutes:number;
}

function dayNumber(date:string){
  return Math.floor(Date.parse(`${date}T00:00:00Z`)/86_400_000);
}

function minutesOf(time:string|null|undefined){
  if(!time)return null;
  const [hours,minutes]=time.split(':').map(Number);
  return Number.isFinite(hours)&&Number.isFinite(minutes)?hours*60+minutes:null;
}

function circularDistance(a:number,b:number){
  const difference=Math.abs(a-b)%1440;
  return Math.min(difference,1440-difference);
}

const newerFirst=(a:Entry,b:Entry)=>b.date.localeCompare(a.date)||(b.time??'').localeCompare(a.time??'');

export function rankRecentFoods(entries:readonly Entry[],context:RecentFoodContext,limit=8):Entry[]{
  const today=dayNumber(context.date);
  const groups=new Map<string,Entry[]>();
  for(const entry of entries){
    if(entry.deleted||entry.date>context.date||!entry.name.trim())continue;
    const key=entry.name.trim().toLowerCase();
    const group=groups.get(key);
    if(group)group.push(entry);else groups.set(key,[entry]);
  }
  const ranked=[...groups.values()].map(group=>{
    group.sort(newerFirst);
    const latest=group[0];
    const inWindow=group.filter(entry=>today-dayNumber(entry.date)<RECENT_WINDOW_DAYS);
    const daysSince=Math.max(0,today-dayNumber(latest.date));
    const timed=inWindow.map(entry=>minutesOf(entry.time)).filter((minutes):minutes is number=>minutes!==null);
    const timeAffinity=timed.length?timed.filter(minutes=>circularDistance(minutes,context.minutes)<=TIME_AFFINITY_MINUTES).length/timed.length:0;
    return {latest,score:inWindow.length+3/(1+daysSince)+2*timeAffinity};
  });
  ranked.sort((a,b)=>b.score-a.score||newerFirst(a.latest,b.latest)||a.latest.name.localeCompare(b.latest.name));
  return ranked.slice(0,limit).map(item=>item.latest);
}

/** A batch line that repeats a logged entry's food and portion exactly. */
export function lineFromEntry(entry:Entry):BasketLine{
  return {
    key:`${lineKey(entry.name,entry.source)}_${crypto.randomUUID().slice(0,8)}`,
    name:entry.name,
    calories:entry.calories,
    protein:entry.protein,
    carbs:entry.carbs,
    fat:entry.fat,
    fiber:entry.fiber,
    source:entry.source,
    quantity:entry.quantity,
    unit:entry.unit,
    portionLabel:entry.portionLabel??null,
    portionGrams:entry.portionGrams??null,
    portions:entry.portionLabel&&entry.portionGrams!=null?[{label:entry.portionLabel,grams:entry.portionGrams}]:[],
  };
}

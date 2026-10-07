import type {Entry} from '../types';
import {RECENT_WINDOW_DAYS,type RecentFoodContext} from './recentFoods';

/** How far either side of now a past entry still counts as eaten "around this time". */
export const AROUND_NOW_MINUTES=90;
/** A food must have been logged near this time on more than one day to count as usual. */
const USUAL_DAYS=2;
export const SECTION_LIMIT=10;

export interface RecentFoodSections {
  /** Foods usually logged around this time of day, most habitual first. */
  aroundNow:Entry[];
  /** The most recently logged other foods, newest first. */
  latest:Entry[];
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

/**
 * The picker's two shortcut lists. Each food is represented by its latest entry, so a tap repeats
 * the last portion. "Around now" scores each food over the last four weeks: every day it was
 * logged within 90 minutes of the current time adds a weight that fades from 1 (today) towards 0
 * at four weeks, so a recent habit outranks an old one. It needs two or more such days, which
 * keeps a one-off meal out. "Latest" lists the remaining foods by when they were last logged.
 */
export function recentFoodSections(entries:readonly Entry[],context:RecentFoodContext,limit=SECTION_LIMIT):RecentFoodSections{
  const today=dayNumber(context.date);
  const groups=new Map<string,Entry[]>();
  for(const entry of entries){
    if(entry.deleted||entry.date>context.date||!entry.name.trim())continue;
    const key=entry.name.trim().toLowerCase();
    const group=groups.get(key);
    if(group)group.push(entry);else groups.set(key,[entry]);
  }
  const foods=[...groups.values()].map(group=>{
    group.sort(newerFirst);
    const nearDays=new Map<string,number>();
    for(const entry of group){
      const age=today-dayNumber(entry.date);
      const minutes=minutesOf(entry.time);
      if(age>=RECENT_WINDOW_DAYS||minutes===null||circularDistance(minutes,context.minutes)>AROUND_NOW_MINUTES)continue;
      nearDays.set(entry.date,1-age/RECENT_WINDOW_DAYS);
    }
    const score=[...nearDays.values()].reduce((sum,weight)=>sum+weight,0);
    return {latest:group[0],usual:nearDays.size>=USUAL_DAYS,score};
  });
  const aroundNow=foods.filter(food=>food.usual)
    .sort((a,b)=>b.score-a.score||newerFirst(a.latest,b.latest)||a.latest.name.localeCompare(b.latest.name))
    .slice(0,limit).map(food=>food.latest);
  const shown=new Set(aroundNow);
  const latest=foods.map(food=>food.latest).filter(entry=>!shown.has(entry)).sort(newerFirst).slice(0,limit);
  return {aroundNow,latest};
}

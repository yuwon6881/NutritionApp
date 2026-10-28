import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import type {NutritionStore} from '../useNutritionStore';
import {shiftDate} from '../lib/energyBalance';
import {sharedDiaryCoordinator} from '../lib/diaryCoordinator';
import {projectedDayIntakes} from '../lib/dayIntake';
import {calendarTarget,calorieProgress} from '../lib/calendarProgress';
import {needsReveal} from '../lib/foodStrip';
import {Button} from './ui/Button';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';

const earliest='2000-01-01';
const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const dayWidth=64;
// Wide windows fit over 16 days, so a fixed fortnight would leave nothing to scroll back into.
const initialDaysBack=30;
const outline='M 28 1.5 A 26.5 26.5 0 0 1 54.5 28 V 50 A 26.5 26.5 0 0 1 28 76.5 A 26.5 26.5 0 0 1 1.5 50 V 28 A 26.5 26.5 0 0 1 28 1.5 Z';

export function FoodWeekStrip({date,today,store,onChange}:{date:string;today:string;store:NutritionStore;onChange:(date:string)=>void}){
  const [range,setRange]=useState(()=>({from:shiftDate(date,-initialDaysBack)<earliest?earliest:shiftDate(date,-initialDaysBack),to:shiftDate(date,14)>shiftDate(today,7)?shiftDate(today,7):shiftDate(date,14)}));
  const [failure,setFailure]=useState('');
  const [,update]=useState(0);
  const track=useRef<HTMLDivElement>(null);
  const prependWidth=useRef(0);
  const reveal=useRef(true);
  const userPicked=useRef<string|null>(null);

  useEffect(()=>sharedDiaryCoordinator.subscribe(()=>update(value=>value+1)),[]);
  useEffect(()=>{
    if(userPicked.current===date){
      userPicked.current=null;
      reveal.current=false;
      return;
    }
    userPicked.current=null;
    if(date<range.from||date>range.to){
      reveal.current=true;
      setRange({from:shiftDate(date,-initialDaysBack)<earliest?earliest:shiftDate(date,-initialDaysBack),to:shiftDate(date,14)>shiftDate(today,7)?shiftDate(today,7):shiftDate(date,14)});
    } else {
      const element=track.current;
      const selected=element?.querySelector<HTMLElement>(`[data-date="${date}"]`);
      if(element&&selected){
        const stripRect=element.getBoundingClientRect();
        const dayRect=selected.getBoundingClientRect();
        if(needsReveal(stripRect,dayRect)){
          selected.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});
        }
      }
      reveal.current=false;
    }
  },[date,range.from,range.to,today]);

  useLayoutEffect(()=>{
    const element=track.current;
    if(!element)return;
    if(prependWidth.current){element.scrollLeft+=prependWidth.current;prependWidth.current=0;}
    if(reveal.current){
      const selected=element.querySelector<HTMLElement>(`[data-date="${date}"]`);
      if(selected)element.scrollLeft=Math.round((selected.offsetLeft-element.offsetLeft-element.clientWidth/2+selected.clientWidth/2)/dayWidth)*dayWidth;
      reveal.current=false;
    }
  },[range,date]);

  useEffect(()=>{
    let active=true;
    const months=new Map<string,string>();
    for(let day=range.from;day<=range.to&&day<=today;day=shiftDate(day,1))months.set(day.slice(0,7),day);
    setFailure('');
    void Promise.all([...months.values()].map(day=>sharedDiaryCoordinator.requestDate(day,today))).catch(error=>{
      if(active)setFailure(error instanceof Error?error.message:'Day progress is unavailable.');
    });
    return()=>{active=false;};
  },[range,today]);

  const extendEarlier=()=>{
    if(range.from<=earliest||prependWidth.current)return;
    const from=shiftDate(range.from,-7)<earliest?earliest:shiftDate(range.from,-7);
    prependWidth.current=Math.round((Date.parse(range.from)-Date.parse(from))/86400000)*dayWidth;
    setRange(previous=>({from,to:previous.to>shiftDate(from,55)?shiftDate(from,55):previous.to}));
  };
  const extendLater=()=>{
    if(range.to>=shiftDate(today,7))return;
    setRange(previous=>{
      const to=shiftDate(previous.to,7)>shiftDate(today,7)?shiftDate(today,7):shiftDate(previous.to,7);
      const from=previous.from<shiftDate(to,-55)?shiftDate(to,-55):previous.from;
      // Removing days from the left preserves the viewport's current dates.
      prependWidth.current=-Math.round((Date.parse(from)-Date.parse(previous.from))/86400000)*dayWidth;
      return {from,to};
    });
  };
  const scroll=(direction:-1|1)=>{
    track.current?.scrollBy({left:direction*dayWidth*7,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  };
  const energyUnit=unitsFor(store.state?.settings).energy;
  const dates:string[]=[];
  for(let day=range.from;day<=range.to;day=shiftDate(day,1))dates.push(day);
  const intakes=projectedDayIntakes(store.local,dates);
  return <div className="food-calendar">
    <div className="food-calendar-navigation">
      <Button variant="tertiary" className="food-calendar-back" aria-label="Scroll calendar back one week" onClick={()=>scroll(-1)}><ChevronLeft size={18}/></Button>
      <Button variant="tertiary" className="food-calendar-forward" aria-label="Scroll calendar forward one week" onClick={()=>scroll(1)}><ChevronRight size={18}/></Button>
    </div>
    <div ref={track} className="food-week-strip" role="group" aria-label="Choose a food day" onScroll={()=>{
      const element=track.current;
      if(!element)return;
      if(element.scrollLeft<dayWidth*3)extendEarlier();
      if(element.scrollWidth-element.clientWidth-element.scrollLeft<dayWidth*3)extendLater();
    }}>
      {dates.map(day=>{
        const intake=intakes.get(day)??null;
        const target=calendarTarget(store.state!,day);
        const progress=calorieProgress(intake,target);
        const weekday=weekdays[new Date(`${day}T12:00:00Z`).getUTCDay()];
        const label=`${day}, ${weekday}${day===today?', today':''}${day===shiftDate(today,1)?', tomorrow':day>today?', future':progress==null?', calorie progress unavailable':`, ${displayEnergy(intake!,energyUnit)} of ${displayEnergy(target!,energyUnit)} ${energyLabel(energyUnit)}, ${Math.round(progress*100)}% of target`}`;
        return <Button key={day} data-date={day} data-today={day===today||undefined} variant="tertiary" presentation="plain" className="food-week-day" disabled={day>shiftDate(today,1)} aria-current={day===date?'date':undefined} aria-label={label} onClick={()=>{userPicked.current=day;onChange(day);}} onKeyDown={event=>{
          if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
          const next=(event.key==='ArrowLeft'?event.currentTarget.previousElementSibling:event.currentTarget.nextElementSibling) as HTMLButtonElement|null;
          if(next&&!next.disabled){event.preventDefault();next.focus();}
        }}>
          <svg className="food-day-progress" viewBox="0 0 56 78" aria-hidden="true">
            <path className="food-day-progress-track" d={outline}/>
            {progress!=null&&progress>0&&<path className="food-day-progress-fill" pathLength="100" strokeDasharray={`${progress*100} 100`} d={outline}/>}
          </svg>
          <span className="food-week-day-name" aria-hidden="true">{weekday}</span>
          <span className="food-week-day-number" aria-hidden="true">{Number(day.slice(8,10))}</span>
        </Button>;
      })}
    </div>
    {failure&&<p className="food-calendar-status" role="status">Saved day progress shown where available. {failure}</p>}
  </div>;
}

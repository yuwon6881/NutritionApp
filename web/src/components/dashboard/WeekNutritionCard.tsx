import {useMemo,useState,type CSSProperties} from 'react';
import type {AppState,EnergyUnit} from '../../types';
import {longDate,number,weekdayShort} from '../../lib/format';
import {displayEnergy,energyLabel} from '../../lib/units';
import {targetShare,weekAverage,weekNutrition,WEEK_NUTRIENTS,type WeekDay,type WeekNutrient} from '../../lib/weekNutrition';
import {Button} from '../ui/Button';
import {SelectionIndicator} from '../ui/Motion';
import './dashboard.css';

const LABELS:Record<WeekNutrient,string>={calories:'Calories',protein:'Protein',carbs:'Carbs',fat:'Fat'};
const WEEK='week';

function amount(key:WeekNutrient,value:number|null,energyUnit:EnergyUnit){
  if(value==null)return '—';
  return key==='calories'?displayEnergy(value,energyUnit):number(value);
}

function unit(key:WeekNutrient,energyUnit:EnergyUnit){
  return key==='calories'?energyLabel(energyUnit):'g';
}

function dayStatusText(day:WeekDay){
  if(day.status==='unknown')return 'not stored on this device';
  if(day.status==='missing')return 'nothing logged';
  return '';
}

/** The accessible summary of one day: each figure against its target, in reading order. */
function dayName(day:WeekDay,current:string,energyUnit:EnergyUnit){
  const when=`${longDate(day.date)}${day.date===current?', today':''}`;
  const status=dayStatusText(day);
  if(status)return `${when}: ${status}`;
  const figures=WEEK_NUTRIENTS.map(key=>{
    const label=key==='calories'?'':`${LABELS[key].toLowerCase()} `;
    const target=day.target[key]==null?'no target':`${amount(key,day.target[key],energyUnit)} ${unit(key,energyUnit)}`;
    if(day.status==='future')return `${label}target ${target}`;
    return `${label}${amount(key,day.intake[key],energyUnit)} of ${target}${day.partial[key]?' (partial)':''}`;
  });
  return `${when}: ${figures.join(', ')}`;
}

/**
 * Nutrition against targets for each day of this Monday-based week, after the
 * MacroFactor dashboard: four bars per day, today boxed. Selecting a day shows its
 * figures; selecting it again shows the average of the week's past logged days.
 * Unknown and unlogged days keep empty tracks and say so; nothing reads as zero.
 */
export function WeekNutritionCard({state,current,energyUnit,checkInDue=false}:{state:AppState;current:string;energyUnit:EnergyUnit;checkInDue?:boolean}){
  const week=useMemo(()=>weekNutrition(state,current,checkInDue?current:undefined),[state,current,checkInDue]);
  const [selected,setSelected]=useState(current);
  const day=week.find(item=>item.date===selected);
  const average=useMemo(()=>weekAverage(week,current),[week,current]);
  const readout=day??{intake:average.intake,target:average.target,partial:{calories:false,protein:false,carbs:false,fat:false},status:average.days?'known':'missing'};
  const caption=day
    ?`${day.date===current?'Today · ':''}${longDate(day.date)}`
    :average.days?`Daily average · ${average.days} logged ${average.days===1?'day':'days'} before today`:'Daily average · no logged days yet';
  const note=day?dayStatusText(day)||(checkInDue&&day.date>=current?'calorie targets appear after your check-in':''):average.days?'':'logged days before today appear here';
  return <article className="panel week-nutrition" aria-labelledby="week-nutrition-title">
    <div className="week-nutrition-heading">
      <p id="week-nutrition-title" className="eyebrow">THIS WEEK</p>
      <p className="week-nutrition-caption" aria-live="polite">{caption}</p>
    </div>
    <SelectionIndicator active={selected} className="week-nutrition-days" role="group" ariaLabel="Days this week">
      {week.map(item=>{
        const pressed=item.date===selected;
        return <Button
          key={item.date}
          presentation="plain"
          data-selection-key={item.date}
          data-status={item.status}
          data-today={item.date===current||undefined}
          className="week-day"
          aria-pressed={pressed}
          aria-label={dayName(item,current,energyUnit)}
          onClick={()=>setSelected(pressed?WEEK:item.date)}
        >
          <span className="week-day-bars" aria-hidden="true">
            {WEEK_NUTRIENTS.map(key=>{
              const share=targetShare(item.intake[key],item.target[key]);
              // Logged with nothing to compare against: a quiet full track, never a guessed share.
              const untargeted=item.status==='known'&&item.intake[key]!=null&&item.target[key]==null;
              return <span key={key} className={`week-day-bar ${key}`} data-untargeted={untargeted||undefined}>
                {share!=null&&share>0&&<span style={{'--share':share} as CSSProperties}/>}
              </span>;
            })}
          </span>
          <span className="week-day-name" aria-hidden="true">{weekdayShort(item.date).slice(0,1)}</span>
          <span className="week-day-date" aria-hidden="true">{Number(item.date.slice(8))}</span>
        </Button>;
      })}
    </SelectionIndicator>
    <dl className="week-nutrition-readout">
      {WEEK_NUTRIENTS.map(key=><div key={key} className={`week-nutrition-figure ${key}`}>
        <dt>{LABELS[key]}</dt>
        <dd>
          <strong>{readout.status==='future'?'—':amount(key,readout.intake[key],energyUnit)}</strong>
          <small> / {amount(key,readout.target[key],energyUnit)} {unit(key,energyUnit)}{readout.partial[key]?' · partial':''}</small>
        </dd>
      </div>)}
    </dl>
    {note&&<p className="week-nutrition-note">{note[0].toUpperCase()+note.slice(1)}.</p>}
  </article>;
}

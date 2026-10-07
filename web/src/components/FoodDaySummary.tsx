import type {Day,Entry} from '../types';
import {number} from '../lib/format';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';

type Macro='protein'|'carbs'|'fat';

export interface DayTargets {
  calories:number|null;
  protein:number|null;
  carbs:number|null;
  fat:number|null;
}

const MACROS:{key:Macro;label:string}[]=[
  {key:'protein',label:'Protein'},
  {key:'carbs',label:'Carbs'},
  {key:'fat',label:'Fat'},
];

function remainingText(total:number,target:number,unit:EnergyUnit){
  const difference=target-total;
  if(Math.abs(difference)<.5)return 'on target';
  return `${displayEnergy(Math.abs(difference),unit)} ${difference>0?'left':'over'}`;
}

/**
 * The day's totals at the top of the Food Log. Wider windows add the day's targets and
 * progress bars; phones keep the compact figures only. A target that is not known
 * (no accepted plan for the date) shows no bar rather than an empty one.
 */
export function FoodDaySummary({title,statusText,entries,day,count,fasting,total,targets,energyUnit}:{
  title:string;
  statusText:string;
  entries:Entry[];
  day:Day|undefined;
  count:number;
  fasting:boolean;
  total:number;
  targets:DayTargets;
  energyUnit:EnergyUnit;
}){
  const archived=!!day?.archived;
  const energyKnown=count>0||fasting;
  const calorieTarget=targets.calories;
  return <section className="panel food-day-summary">
    <div className="section-heading">
      <div><h2>{title}</h2><p>{statusText}</p></div>
      <div className="food-day-energy">
        <strong className="figure-inline">{energyKnown?displayEnergy(total,energyUnit):'—'} <span className="unit">{energyLabel(energyUnit)}</span></strong>
        {calorieTarget!=null&&<small className="food-day-target">of {displayEnergy(calorieTarget,energyUnit)}{energyKnown?` · ${remainingText(total,calorieTarget,energyUnit)}`:''}</small>}
      </div>
    </div>
    {calorieTarget!=null&&<progress className="food-day-progress-bar" aria-label="Calories logged against target" value={energyKnown?total:0} max={Math.max(calorieTarget,1)}/>}
    <dl className="food-day-nutrients">{MACROS.map(({key,label})=>{
      const known=entries.filter(e=>e[key]!=null);
      const value=archived?day?.[key]??null:known.length?known.reduce((sum,e)=>sum+e[key]!,0):null;
      const partial=!archived&&known.length>0&&known.length<entries.length;
      const target=targets[key];
      return <div key={key} className={`food-day-nutrient ${key}`}>
        <dt>{label}</dt>
        <dd>{number(value)} g{target!=null&&<small className="food-day-target"> / {number(target)} g</small>}{partial?' · partial':''}</dd>
        {target!=null&&<progress className="food-day-progress-bar" aria-label={`${label} logged against target`} value={value??0} max={Math.max(target,1)}/>}
      </div>;
    })}</dl>
  </section>;
}

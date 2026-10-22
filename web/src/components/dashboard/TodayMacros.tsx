import type {Day,Entry} from '../../types';
import {number} from '../../lib/format';
import {dayIntake} from '../../lib/weekNutrition';
import {PartialMark,PartialNote} from '../ui/PartialMark';

type Macro='protein'|'carbs'|'fat';
type MacroTargets=Record<Macro,number|null|undefined>;

const MACROS:{key:Macro;label:string}[]=[
  {key:'protein',label:'Protein'},
  {key:'carbs',label:'Carbs'},
  {key:'fat',label:'Fat'},
];

/**
 * The Dashboard's macros for one date against its targets. A total that leaves out foods with no
 * value for the nutrient is marked Partial; a nutrient no food reports reads as unknown (—),
 * never as zero.
 */
export function TodayMacros({entries,savedDay,targets}:{entries:Entry[];savedDay:Day|undefined;targets:MacroTargets}){
  const {intake,partial}=dayIntake(entries,savedDay);
  // Nothing logged yet today is a known zero; a nutrient no logged food reports stays unknown.
  const empty=!entries.length&&!savedDay?.archived;
  return <article className="panel macros">
    <p className="eyebrow">Macronutrients</p>
    {MACROS.map(({key,label})=>{
      const value=intake[key]??(empty?0:null);
      const target=targets[key];
      return <div className={'macro '+key} key={key}>
        <span>{label}</span>
        <strong>{number(value)}<small>{target==null?'No target':`/ ${number(target)} g`}</small>{partial[key]&&<PartialMark/>}</strong>
        <progress aria-label={`${key} logged`} value={target==null?0:value??0} max={target==null?1:Math.max(target,1)}/>
      </div>;
    })}
    {MACROS.some(({key})=>partial[key])&&<PartialNote/>}
  </article>;
}

import type {Day,Entry} from '../../types';
import {number} from '../../lib/format';
import {dayIntake,macroRemainingText} from '../../lib/weekNutrition';
import {Button} from '../ui/Button';
import {PartialMark} from '../ui/PartialMark';

type Macro='protein'|'carbs'|'fat';
type MacroTargets=Record<Macro,number|null|undefined>;

const MACROS:{key:Macro;label:string}[]=[
  {key:'protein',label:'Protein'},
  {key:'carbs',label:'Carbs'},
  {key:'fat',label:'Fat'},
];

/**
 * The Dashboard's macros for one date against its targets: the three macros only, so the card
 * stays a glance (fiber and the longer partial explanation live in the Food Log). A total that
 * leaves out foods with no value for the nutrient keeps its compact Partial mark, which carries
 * its own explanation; a nutrient no food reports reads as unknown (—), never as zero.
 */
export function TodayMacros({entries,savedDay,targets,onLogFood}:{entries:Entry[];savedDay:Day|undefined;targets:MacroTargets;onLogFood?:(trigger?:HTMLElement|null)=>void}){
  const {intake,partial}=dayIntake(entries,savedDay);
  // Nothing logged yet today is a known zero; a nutrient no logged food reports stays unknown.
  const empty=!entries.length;
  return <article className="panel macros">
    <div className="dashboard-panel-head macros-head">
      <p className="eyebrow">Macronutrients</p>
      {onLogFood&&<Button variant="tertiary" size="sm" className="dashboard-inline-action" aria-label="Log food from Dashboard" onClick={event=>onLogFood(event.currentTarget)}>Add food</Button>}
    </div>
    {MACROS.map(({key,label})=>{
      const value=intake[key]??(empty?0:null);
      const target=targets[key];
      const remaining=macroRemainingText(value,target);
      const over=value!=null&&target!=null&&value-target>=0.5;
      return <div className={'macro '+key} key={key}>
        <span>{label}</span>
        <strong>{number(value)}<small>{target==null?'No target':`/ ${number(target)} g`}</small>{partial[key]&&<PartialMark/>}</strong>
        {remaining&&<small className={`macro-remaining${over?' is-over':''}`}>{remaining}</small>}
        <progress aria-label={`${key} logged`} value={target==null?0:value??0} max={target==null?1:Math.max(target,1)}/>
      </div>;
    })}
  </article>;
}

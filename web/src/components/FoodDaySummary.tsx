import type {Day,Entry} from '../types';
import {number} from '../lib/format';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';
import {dayIntake} from '../lib/weekNutrition';
import {SelectField} from './ui/Field';
import {PartialMark,PartialNote} from './ui/PartialMark';

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
 * The day's totals at the top of the Food Log, with the day's targets and progress bars at
 * every width. A target that is not known (no accepted plan for the date) shows no bar
 * rather than an empty one. A macro total that leaves out foods with no value for it is
 * marked Partial, with one explanation under the tiles.
 */
export function FoodDaySummary({
  title,
  statusText,
  entries,
  day,
  count,
  fasting,
  total,
  targets,
  energyUnit,
  isPastDay = false,
  statusValue = 'incomplete',
  statusDisabled = false,
  canFast = false,
  onStatusChange,
}:{
  title:string;
  statusText:string;
  entries:Entry[];
  day:Day|undefined;
  count:number;
  fasting:boolean;
  total:number;
  targets:DayTargets;
  energyUnit:EnergyUnit;
  isPastDay?:boolean;
  statusValue?:string;
  statusDisabled?:boolean;
  canFast?:boolean;
  onStatusChange?:(value:string)=>void;
}){
  const archived=!!day?.archived;
  const energyKnown=count>0||fasting;
  const calorieTarget=targets.calories;
  const {intake,partial}=dayIntake(entries,day);
  const macros=MACROS.map(({key,label})=>({key,label,value:intake[key],target:targets[key],partial:partial[key]}));
  return <section className="panel food-day-summary">
    <div className="section-heading">
      <div className="food-day-title-group">
        <h2>{title}</h2>
        {/* A past day can record a decision: fasting or not logging without food, or "not fully logged" when a meal is missing. */}
        {isPastDay && !statusDisabled ? (
          <div className="food-day-status-control">
            <SelectField
              label="Logging status"
              className="food-day-status-select"
              disabled={statusDisabled}
              value={statusValue}
              onChange={onStatusChange ?? (() => {})}
            >
              <option value="incomplete">{count ? 'Complete automatically' : 'No food logged'}</option>
              <option value="not_logged">{count ? 'Not fully logged' : 'Not logging'}</option>
              <option value="fasting" disabled={!canFast}>Fasting</option>
            </SelectField>
          </div>
        ) : (
          <p className="food-day-status-text">{statusText}</p>
        )}
      </div>
      <div className="food-day-energy">
        <strong className="figure-inline">{energyKnown?displayEnergy(total,energyUnit):'—'} <span className="unit">{energyLabel(energyUnit)}</span></strong>
        {calorieTarget!=null&&<small className="food-day-target">of {displayEnergy(calorieTarget,energyUnit)}{energyKnown?` · ${remainingText(total,calorieTarget,energyUnit)}`:''}</small>}
      </div>
    </div>
    {calorieTarget!=null&&<progress className="food-day-progress-bar" aria-label="Calories logged against target" value={energyKnown?total:0} max={Math.max(calorieTarget,1)}/>}
    <dl className="food-day-nutrients">{macros.map(({key,label,value,target,partial})=><div key={key} className={`food-day-nutrient ${key}`}>
      <dt>{label}</dt>
      <dd>
        <span className="food-day-value">{number(value)} g</span>
        {target!=null&&<small className="food-day-target">/ {number(target)} g</small>}
        {partial&&<PartialMark/>}
      </dd>
      {target!=null&&<progress className="food-day-progress-bar" aria-label={`${label} logged against target`} value={value??0} max={Math.max(target,1)}/>}
    </div>)}</dl>
    {macros.some(macro=>macro.partial)&&<PartialNote/>}
  </section>;
}

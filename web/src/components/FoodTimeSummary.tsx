import type {Entry} from '../types';
import {number} from '../lib/format';
import {dayIntake} from '../lib/weekNutrition';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';

const macros=[{key:'protein',short:'P',label:'Protein'},{key:'carbs',short:'C',label:'Carbs'},{key:'fat',short:'F',label:'Fat'}] as const;

export function FoodTimeSummary({entries,energyUnit}:{entries:Entry[];energyUnit:EnergyUnit}){
  const {intake,partial}=dayIntake(entries,undefined);
  return <div className="food-time-summary" aria-label="Time group totals">
    <strong>{displayEnergy(intake.calories??0,energyUnit)} <small>{energyLabel(energyUnit)}</small></strong>
    {macros.map(({key,short,label})=><span key={key} className={`food-time-summary-macro ${key}`}>
      <b aria-hidden="true">{short}</b><span className="sr-only">{label}</span> {number(intake[key],1)} g
      {partial[key]&&<span className="food-time-summary-partial" title="Some foods have no value for this nutrient"> partial</span>}
    </span>)}
  </div>;
}

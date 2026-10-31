import type {CoachResult,UnitPreferences} from '../../types';
import {number} from '../../lib/format';
import {splitFromGrams} from '../../lib/macros';
import {displayEnergy,energyLabel} from '../../lib/units';
import {energyGap,proteinPerKg} from '../../lib/coachTargetSummary';
import {TargetWeeklySummary} from './TargetWeeklySummary';

const MACRO_ROWS=[
  {key:'protein',label:'Protein'},
  {key:'carbs',label:'Carbs'},
  {key:'fat',label:'Fat'}
] as const;

function gapLabel(gap:ReturnType<typeof energyGap>,units:UnitPreferences):string|null{
  if(!gap)return null;
  if(gap.direction==='at')return 'At maintenance';
  return `${displayEnergy(gap.kcal,units.energy)} ${energyLabel(units.energy)} ${gap.direction} maintenance`;
}

/** Daily energy against maintenance, the macro split as labelled rows, and the weekly budget. */
export function TargetFigures({result,units,weightKg}:{result:CoachResult;units:UnitPreferences;weightKg?:number|null}){
  const split=splitFromGrams(result.calories,{protein:result.protein,carbs:result.carbs,fat:result.fat});
  const gap=energyGap(result.calories,result.expenditure);
  const label=gapLabel(gap,units);
  const perKg=proteinPerKg(result.protein,weightKg);
  return <div className="target-figures">
    <div className="target-energy-figures">
      <div>
        <p>Eat per day</p>
        <strong>{displayEnergy(result.calories,units.energy)} <span className="unit">{energyLabel(units.energy)}</span></strong>
      </div>
      {label&&<div className="target-energy-gap">
        <span className={`target-gap-chip ${gap?.direction}`}>{label}</span>
        <span className="target-gap-detail">Maintenance {displayEnergy(result.expenditure,units.energy)} {energyLabel(units.energy)}</span>
      </div>}
    </div>
    <div className="target-macros-section">
      <div className="target-macros-figures target-macro-rows">
        {MACRO_ROWS.map(({key,label:name})=><div key={key}>
          <p><span className={`macro-dot ${key}`} aria-hidden="true"/>{name}</p>
          <strong>{number(result[key])} <span className="unit">g</span></strong>
          {split&&<span className="target-macro-meta"><span className="target-macro-pct">{split[key]}%</span><span className="target-macro-note"> of energy{key==='protein'&&perKg!=null?` · ${perKg} g/kg`:''}</span></span>}
          {split&&<span className="target-macro-track" aria-hidden="true"><span className={key} style={{width:`${split[key]}%`}}/></span>}
        </div>)}
      </div>
    </div>
    <TargetWeeklySummary result={result} units={units}/>
  </div>;
}

import {useMemo} from 'react';
import {allocateWeeklyCalories,equalDistribution,normaliseDistribution} from '../lib/dailyTargets';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import type {EnergyUnit} from '../types';
import {displayEnergy,energyLabel,inputEnergy,parseEnergy} from '../lib/units';

const labels=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

export function WeeklyProgramSetup({
  budget,
  values,
  energyUnit='kcal',
  onChange,
}:{
  budget:number;
  values:number[];
  energyUnit?:EnergyUnit;
  onChange:(values:number[])=>void;
}){
  const target=Math.round(budget);
  const sum=values.reduce((total,value)=>total+(Number.isFinite(value)?value:0),0);
  const valid=values.length===7&&values.every(value=>Number.isInteger(value)&&value>=0)&&sum===target;
  const remaining=target-sum;
  const equal=useMemo(()=>allocateWeeklyCalories(target,equalDistribution()),[target]);
  return <section className="weekly-program" aria-labelledby="weekly-program-title">
    <div className="section-heading">
      <div><h3 id="weekly-program-title">Weekly calorie distribution</h3><p>Keep the same weekly budget while choosing how it lands across the week.</p></div>
      <Button type="button" variant="secondary" size="sm" onClick={()=>onChange(equal)}>Equal distribution</Button>
    </div>
    <div className="weekly-program-grid">
      {labels.map((label,index)=><Field key={label} id={`weekly-calories-${index}`} name={`weeklyCalories${index}`} label={`${label} (${energyLabel(energyUnit)})`} type="number" min="0" step="1" value={values[index]==null?'':inputEnergy(values[index],energyUnit,0)} onChange={event=>{
        const next=[...values];const parsed=parseEnergy(event.target.value,energyUnit);next[index]=event.target.value===''?0:Number.isFinite(parsed)?Math.round(parsed):0;onChange(next);
      }}/>) }
    </div>
    <div className={`weekly-program-total ${valid?'valid':'invalid'}`} role="status" aria-live="polite">
      <span>Weekly budget <strong>{displayEnergy(target,energyUnit)} {energyLabel(energyUnit)}</strong></span>
      <span>{valid?'Exact budget':'Remaining '+displayEnergy(Math.abs(remaining),energyUnit)+' '+energyLabel(energyUnit)+(remaining<0?' over':'')}</span>
    </div>
    {!valid&&<p className="error">Enter seven non-negative whole {energyLabel(energyUnit)} targets that total exactly {displayEnergy(target,energyUnit)} {energyLabel(energyUnit)}.</p>}
    {valid&&<p className="source">Your saved distribution is {normaliseDistribution(values)?.map(value=>`${Math.round(value)}%`).join(' / ')} from Monday through Sunday.</p>}
  </section>;
}

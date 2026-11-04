import {TrendingDown,TrendingUp} from 'lucide-react';
import type {EnergyUnit,WeightContextCode,WeightUnit} from '../types';
import type {UnusualWeightDifference} from '../lib/weightContext';
import type {RecentIntake} from '../lib/weighInEvidence';
import {displayEnergy,displayWeight,energyLabel,weightLabel} from '../lib/units';
import {WeightContextPicker} from './WeightContextPicker';

export interface UnusualWeighInNoteProps {
  unusual:UnusualWeightDifference;
  weightUnit:WeightUnit;
  energyUnit:EnergyUnit;
  intake:RecentIntake|null;
  target:number|null|undefined;
  unloggedBefore:boolean;
  value:WeightContextCode|'';
  onChange:(value:WeightContextCode|'')=>void;
}

/**
 * The outlier filter already keeps a one-off swing out of the trend, so a reason is optional. The note leads with
 * the difference and one line of evidence, then offers the reasons as one-tap chips without a step to open them.
 * The last weigh-in and trend already sit above the field, so they are not repeated here.
 */
export function UnusualWeighInNote({unusual,weightUnit,energyUnit,intake,target,unloggedBefore,value,onChange}:UnusualWeighInNoteProps){
  const kg=(amount:number)=>`${displayWeight(amount,weightUnit,1)} ${weightLabel(weightUnit)}`;
  const kcal=(amount:number)=>`${displayEnergy(amount,energyUnit)} ${energyLabel(energyUnit)}`;
  const evidence=[
    unloggedBefore?'Day before not logged':null,
    intake?`${intake.days}-day average ${kcal(intake.averageKcal)}${target?` of ${kcal(target)}`:''}`:null,
  ].filter((part):part is string=>part!==null);
  const Direction=unusual.direction==='up'?TrendingUp:TrendingDown;
  return <section className="weight-context-prompt" aria-labelledby="weight-context-heading">
    <div className="weight-context-summary">
      <span className="weight-context-icon" aria-hidden="true"><Direction size={18}/></span>
      <div>
        <h3 id="weight-context-heading">{unusual.direction==='up'?'Up':'Down'} {kg(unusual.differenceKg)} from expected</h3>
        {evidence.length>0&&<p className="weight-context-evidence">{evidence.join(' · ')}</p>}
      </div>
    </div>
    <WeightContextPicker direction={unusual.contextDirection} value={value} onChange={onChange}/>
  </section>;
}

import {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import type {EnergyUnit,WeightContextCode,WeightUnit} from '../types';
import type {UnusualWeightDifference} from '../lib/weightContext';
import type {RecentIntake} from '../lib/weighInEvidence';
import {displayEnergy,displayWeight,energyLabel,weightLabel} from '../lib/units';
import {Button} from './ui/Button';
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
 * the difference alone; one line of evidence and the reasons wait behind "Add a reason", which opens by itself
 * when the weigh-in already carries one. The last weigh-in and trend already sit above the field, so they are not
 * repeated here.
 */
export function UnusualWeighInNote({unusual,weightUnit,energyUnit,intake,target,unloggedBefore,value,onChange}:UnusualWeighInNoteProps){
  const [opened,setOpened]=useState(false);
  const expanded=opened||value!=='';
  const kg=(amount:number)=>`${displayWeight(amount,weightUnit,1)} ${weightLabel(weightUnit)}`;
  const kcal=(amount:number)=>`${displayEnergy(amount,energyUnit)} ${energyLabel(energyUnit)}`;
  const evidence=[
    unloggedBefore?'Day before not logged':null,
    intake?`${intake.days}-day average ${kcal(intake.averageKcal)}${target?` of ${kcal(target)}`:''}`:null,
  ].filter((part):part is string=>part!==null);
  return <section className={`weight-context-prompt${expanded?' expanded':''}`} aria-labelledby="weight-context-heading">
    <div className="weight-context-summary">
      <div>
        <h3 id="weight-context-heading">{unusual.direction==='up'?'Up':'Down'} {kg(unusual.differenceKg)} from expected</h3>
        <p>No reason needed — one-off swings are smoothed out automatically.</p>
      </div>
      <Button type="button" variant="tertiary" size="sm" className="weight-context-toggle" aria-expanded={expanded}
        disabled={value!==''} onClick={()=>setOpened(open=>!open)}>
        Add a reason<ChevronDown size={16} aria-hidden="true"/>
      </Button>
    </div>
    {expanded&&<>
      {evidence.length>0&&<p className="weight-context-evidence">{evidence.join(' · ')}</p>}
      <WeightContextPicker direction={unusual.contextDirection} value={value} onChange={onChange}/>
    </>}
  </section>;
}

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
 * The outlier filter already keeps a one-off swing out of the trend, so a reason is rarely needed. The note
 * leads with the difference alone; the evidence and the reasons wait behind "Add a reason", which opens by
 * itself when the weigh-in already carries one.
 */
export function UnusualWeighInNote({unusual,weightUnit,energyUnit,intake,target,unloggedBefore,value,onChange}:UnusualWeighInNoteProps){
  const [opened,setOpened]=useState(false);
  const expanded=opened||value!=='';
  const kg=(amount:number)=>`${displayWeight(amount,weightUnit,1)} ${weightLabel(weightUnit)}`;
  const kcal=(amount:number)=>`${displayEnergy(amount,energyUnit)} ${energyLabel(energyUnit)}`;
  return <section className={`weight-context-prompt${expanded?' expanded':''}`} aria-labelledby="weight-context-heading">
    <div className="weight-context-summary">
      <div>
        <h3 id="weight-context-heading">{unusual.direction==='up'?'Up':'Down'} {kg(unusual.differenceKg)} from the expected {kg(unusual.expectedKg)}</h3>
        <p>One-off swings are smoothed out of your trend automatically.</p>
      </div>
      <Button type="button" variant="tertiary" size="sm" className="weight-context-toggle" aria-expanded={expanded}
        disabled={value!==''} onClick={()=>setOpened(open=>!open)}>
        Add a reason<ChevronDown size={16} aria-hidden="true"/>
      </Button>
    </div>
    {expanded&&<>
      {(unusual.contextDirection==='either'||unloggedBefore||intake)&&<p className="weight-context-evidence">
        {unusual.contextDirection==='either'&&<>Your last weigh-in was {kg(unusual.latestKg)}, so this is not clearly a rise or a drop. </>}
        {unloggedBefore&&<>The day before was not logged. </>}
        {intake&&<>Your last {intake.days} logged days averaged {kcal(intake.averageKcal)}{target?<> against a {kcal(target)} target</>:null}.</>}
      </p>}
      <p>A temporary reason also keeps it out of calorie estimates until later weigh-ins confirm the level.</p>
      <WeightContextPicker direction={unusual.contextDirection} value={value} onChange={onChange}/>
    </>}
  </section>;
}

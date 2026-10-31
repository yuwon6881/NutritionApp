import type {ProfileDraft,UnitPreferences} from '../../types';
import {displayHeight,displayWeight,weightLabel} from '../../lib/units';
import {paceSentence} from '../../lib/coachTargetSummary';

/** The saved profile inputs behind the targets, as a short key/value list. */
export function PlanDetails({profile,weightKg,macroLabel,age,units}:{
  profile:ProfileDraft;
  weightKg:number|null|undefined;
  macroLabel:string;
  age:number|string|null|undefined;
  units:UnitPreferences;
}){
  const paced=profile.goal&&profile.goal!=='maintain';
  const rate=profile.goalRatePercent??(profile.goal==='lose'?-0.5:0.15);
  const body=[
    `${displayWeight(profile.weightKg,units.weight,1)} ${weightLabel(units.weight)}`,
    displayHeight(profile.heightCm,units.height),
    age?`${age} yrs`:null
  ].filter(Boolean).join(' · ');
  return <dl className="strategy-figures">
    {paced&&<div><dt>Pace</dt><dd>{paceSentence(rate,weightKg,units.weight)}</dd></div>}
    <div><dt>Macro split</dt><dd>{macroLabel}</dd></div>
    <div><dt>Body</dt><dd>{body}</dd></div>
  </dl>;
}

import {Gauge,PieChart,Ruler,type LucideIcon} from 'lucide-react';
import type {ReactNode} from 'react';
import type {ProfileDraft,UnitPreferences} from '../../types';
import {displayHeight,displayWeight,weightLabel} from '../../lib/units';
import {paceSentence} from '../../lib/coachTargetSummary';
import {Button} from '../ui/Button';

export type PlanQuickStep='body'|'goal'|'pace'|'macros'|'distribution';

function DetailRow({icon:Icon,label,children}:{icon:LucideIcon;label:string;children:ReactNode}){
  return <div>
    <span className="coach-icon-tile" aria-hidden="true"><Icon size={18}/></span>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>;
}

/** The saved profile inputs behind the targets, as a short key/value list. */
export function PlanDetails({profile,weightKg,macroLabel,age,units,onEditStep,disabled}:{
  profile:ProfileDraft;
  weightKg:number|null|undefined;
  macroLabel:string;
  age:number|string|null|undefined;
  units:UnitPreferences;
  onEditStep?:(step:PlanQuickStep)=>void;
  disabled?:boolean;
}){
  const paced=profile.goal&&profile.goal!=='maintain';
  const rate=profile.goalRatePercent??(profile.goal==='lose'?-0.5:0.15);
  const body=[
    `${displayWeight(profile.weightKg,units.weight,1)} ${weightLabel(units.weight)}`,
    displayHeight(profile.heightCm,units.height),
    age?`${age} yrs`:null
  ].filter((value):value is string=>Boolean(value));
  return <>
    <dl className="strategy-figures">
      {paced&&<DetailRow icon={Gauge} label="Pace">{paceSentence(rate,weightKg,units.weight)}</DetailRow>}
      <DetailRow icon={PieChart} label="Macro split">{macroLabel}</DetailRow>
      <DetailRow icon={Ruler} label="Body">
        <span className="strategy-chips">{body.map(value=><span key={value} className="strategy-chip">{value}</span>)}</span>
      </DetailRow>
    </dl>
    {onEditStep&&<div className="plan-quick-edit" role="group" aria-label="Quick edit plan sections">
      <Button variant="tertiary" size="sm" disabled={disabled} onClick={()=>onEditStep('body')}>Edit body</Button>
      <Button variant="tertiary" size="sm" disabled={disabled} onClick={()=>onEditStep('goal')}>Edit goal</Button>
      {paced&&<Button variant="tertiary" size="sm" disabled={disabled} onClick={()=>onEditStep('pace')}>Edit pace</Button>}
      <Button variant="tertiary" size="sm" disabled={disabled} onClick={()=>onEditStep('macros')}>Edit macros</Button>
      <Button variant="tertiary" size="sm" disabled={disabled} onClick={()=>onEditStep('distribution')}>Edit weekly split</Button>
    </div>}
  </>;
}

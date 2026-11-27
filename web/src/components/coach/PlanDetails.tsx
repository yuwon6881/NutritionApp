import {Gauge,Pencil,PieChart,Ruler,type LucideIcon} from 'lucide-react';
import {useId,type ReactNode} from 'react';
import type {ProfileDraft,UnitPreferences} from '../../types';
import {displayHeight,displayWeight,weightLabel} from '../../lib/units';
import {paceSentence} from '../../lib/coachTargetSummary';
import {Button} from '../ui/Button';

export type PlanQuickStep='body'|'goal'|'pace'|'macros'|'distribution';

const QUICK_EDITS:{step:PlanQuickStep;label:string}[]=[
  {step:'body',label:'Body'},
  {step:'goal',label:'Goal'},
  {step:'pace',label:'Pace'},
  {step:'macros',label:'Macros'},
  {step:'distribution',label:'Weekly split'},
];

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
  const titleId=useId();
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
    {onEditStep&&<div className="plan-quick-edit" role="group" aria-labelledby={titleId}>
      <p id={titleId} className="plan-quick-edit-title">Edit part of your plan</p>
      <div className="plan-quick-edit-actions">
        {QUICK_EDITS.filter(item=>paced||item.step!=='pace').map(item=><Button
          key={item.step}
          variant="secondary"
          size="sm"
          disabled={disabled}
          aria-label={`Edit ${item.label.toLowerCase()}`}
          onClick={()=>onEditStep(item.step)}
        ><Pencil size={15} aria-hidden="true"/>{item.label}</Button>)}
      </div>
    </div>}
  </>;
}

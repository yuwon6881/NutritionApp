import type {EnergyUnit} from '../types';
import {displayEnergy,energyLabel} from '../lib/units';
import {useIntroProgress} from './ui/useIntroProgress';

const circumference=301.59;

/**
 * Today's calories against the target, with the logged calories inside the
 * ring; the Dashboard shows what is left and the target beside it. On the first
 * Dashboard of a launch the ring draws in while the logged figure counts up to
 * its value; the accessible name always carries the true numbers.
 *
 * With `pending`, food that is about to be logged draws as a lighter arc after
 * the logged arc, and the centre reads what would be left or over afterwards.
 */
export function EnergyRing({total,target,energyUnit,intro,pending}:{total:number;target:number|null|undefined;energyUnit:EnergyUnit;intro:boolean;pending?:number}){
  const progress=useIntroProgress(intro);
  const ratio=target?Math.min(total/target,1):0;
  const after=total+(pending??0);
  const pendingRatio=target?Math.min(after/target,1)-ratio:0;
  const unit=energyLabel(energyUnit);
  const label=pending!=null
    ?target
      ?`${displayEnergy(after,energyUnit)} of ${displayEnergy(target,energyUnit)} ${unit} after logging, including ${displayEnergy(pending,energyUnit)} ${unit} from this batch`
      :`${displayEnergy(after,energyUnit)} ${unit} after logging`
    :target
      ?`${displayEnergy(total,energyUnit)} of ${displayEnergy(target,energyUnit)} ${unit} logged`
      :`${displayEnergy(total,energyUnit)} ${unit} logged`;
  const over=pending!=null&&!!target&&after>target;
  const centre=pending!=null
    ?{value:target?displayEnergy(Math.abs(target-after),energyUnit):'—',caption:over?'over':'left'}
    // The logged figure counts up as the ring fills, so both tell one story; past the target it simply keeps counting.
    :{value:displayEnergy(total*progress,energyUnit),caption:`${unit} logged`};
  // A round line cap draws a zero-length arc as a dot, which would read as food already logged.
  const fillLength=ratio*progress*circumference;
  const pendingLength=pendingRatio*progress*circumference;
  return <svg className={`energy-ring${progress<1?' energy-ring-intro':''}`} viewBox="0 0 120 120" role="img" aria-label={label}>
    <circle className="ring-track" cx="60" cy="60" r="48"/>
    {pending!=null&&pendingLength>0&&<circle className="ring-pending" cx="60" cy="60" r="48" strokeDasharray={`${pendingLength} ${circumference}`} strokeDashoffset={-fillLength} transform="rotate(-90 60 60)"/>}
    {fillLength>0&&<circle className="ring-fill" cx="60" cy="60" r="48" strokeDasharray={`${fillLength} ${circumference}`} transform="rotate(-90 60 60)"/>}
    <text className={over?'ring-value ring-over':'ring-value'} x="60" y="58" textAnchor="middle">{centre.value}</text>
    <text className={over?'ring-label ring-over':'ring-label'} x="60" y="76" textAnchor="middle">{centre.caption}</text>
  </svg>;
}

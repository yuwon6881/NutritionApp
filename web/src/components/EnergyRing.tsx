import type {EnergyUnit} from '../types';
import {displayEnergy,energyLabel} from '../lib/units';
import {useIntroProgress} from './ui/useIntroProgress';

const circumference=301.59;

/**
 * Today's calories against the target. On the first Dashboard of a launch the
 * ring draws in while the remaining figure counts down to its value; the
 * accessible name always carries the true numbers.
 */
export function EnergyRing({total,target,energyUnit,intro}:{total:number;target:number|null|undefined;energyUnit:EnergyUnit;intro:boolean}){
  const progress=useIntroProgress(intro);
  const ratio=target?Math.min(total/target,1):0;
  const remaining=target?Math.max(target-total,0):null;
  // Remaining starts at the full target and falls as the ring fills, so both tell one story.
  const shownRemaining=remaining==null||!target?null:target-(target-remaining)*progress;
  const label=target
    ?`${displayEnergy(total,energyUnit)} of ${displayEnergy(target,energyUnit)} ${energyLabel(energyUnit)} logged`
    :`${displayEnergy(total,energyUnit)} ${energyLabel(energyUnit)} logged`;
  return <svg className={`energy-ring${progress<1?' energy-ring-intro':''}`} viewBox="0 0 120 120" role="img" aria-label={label}>
    <circle className="ring-track" cx="60" cy="60" r="48"/>
    <circle className="ring-fill" cx="60" cy="60" r="48" strokeDasharray={`${ratio*progress*circumference} ${circumference}`} transform="rotate(-90 60 60)"/>
    <text x="60" y="58" textAnchor="middle">{shownRemaining==null?'—':displayEnergy(shownRemaining,energyUnit)}</text>
    <text className="ring-label" x="60" y="76" textAnchor="middle">{total>(target??Infinity)?'target reached':'remaining'}</text>
  </svg>;
}

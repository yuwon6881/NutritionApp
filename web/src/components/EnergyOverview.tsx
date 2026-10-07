import type {EnergyUnit} from '../types';
import {displayEnergy,energyLabel} from '../lib/units';
import {EnergyRing} from './EnergyRing';

/**
 * The Dashboard's calories in one row: what is left (or over) on the left, the ring
 * holding the logged calories in the middle, and the target on the right. Each
 * figure appears once; an unknown target stays unknown rather than reading as zero.
 */
export function EnergyOverview({total,target,energyUnit,intro}:{total:number;target:number|null|undefined;energyUnit:EnergyUnit;intro:boolean}){
  const unit=energyLabel(energyUnit);
  const difference=target?target-total:null;
  return <div className="energy-overview">
    <p className="energy-side energy-left">
      {difference==null
        ?<><strong>—</strong><span>Set up your coach</span></>
        :difference>=0
          ?<><strong>{displayEnergy(difference,energyUnit)}</strong><span>{unit} left</span></>
          :<><strong className="energy-over">{displayEnergy(-difference,energyUnit)}</strong><span>{unit} over</span></>}
    </p>
    <EnergyRing total={total} target={target} energyUnit={energyUnit} intro={intro}/>
    <p className="energy-side energy-target">
      <strong>{target?displayEnergy(target,energyUnit):'—'}</strong><span>{unit} target</span>
    </p>
  </div>;
}

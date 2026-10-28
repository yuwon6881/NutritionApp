import type {EnergyUnit} from '../types';
import {displayEnergy,energyLabel} from './units';

export interface ConfirmLabelOptions {
  changed:boolean;
  calories:number|null|undefined;
  unit:EnergyUnit;
  defaultLabel?:string;
}

export function confirmLabel({changed,calories,unit,defaultLabel='Accept'}:ConfirmLabelOptions):string{
  if(!changed&&calories!=null&&Number.isFinite(calories)){
    return `Keep ${displayEnergy(calories,unit)} ${energyLabel(unit)}`;
  }
  return defaultLabel;
}

import type {CoachingSettings,EnergyUnit,HeightUnit,UnitPreferences,WeightUnit} from '../types';
import {number} from './format';

export const defaultUnits:UnitPreferences={weight:'kg',energy:'kcal',height:'cm'};
const poundsPerKg=2.2046226218;
const kjPerKcal=4.184;

export function unitsFor(settings?:Pick<CoachingSettings,'weightUnit'|'energyUnit'|'heightUnit'>|null):UnitPreferences{
  return {
    weight:settings?.weightUnit==='lb'?'lb':'kg',
    energy:settings?.energyUnit==='kj'?'kj':'kcal',
    height:settings?.heightUnit==='ft-in'?'ft-in':'cm',
  };
}

export function weightLabel(unit:WeightUnit){return unit==='lb'?'lb':'kg';}
export function energyLabel(unit:EnergyUnit){return unit==='kj'?'kJ':'kcal';}
export function heightLabel(unit:HeightUnit){return unit==='ft-in'?'ft / in':'cm';}

export function weightValue(kg:number|null|undefined,unit:WeightUnit){
  return kg==null?null:kg*(unit==='lb'?poundsPerKg:1);
}
export function energyValue(kcal:number|null|undefined,unit:EnergyUnit){
  return kcal==null?null:kcal*(unit==='kj'?kjPerKcal:1);
}

export function displayWeight(kg:number|null|undefined,unit:WeightUnit,digits=1){
  return number(weightValue(kg,unit),digits);
}
export function inputWeight(kg:number|null|undefined,unit:WeightUnit,digits=1){
  if(kg==null||!Number.isFinite(kg))return '';
  return (kg*(unit==='lb'?poundsPerKg:1)).toFixed(digits).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
}
export function parseWeight(value:string,unit:WeightUnit){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed/(unit==='lb'?poundsPerKg:1):NaN;
}

export function displayEnergy(kcal:number|null|undefined,unit:EnergyUnit,digits=0){
  return number(energyValue(kcal,unit),digits);
}
export function inputEnergy(kcal:number|null|undefined,unit:EnergyUnit,digits=0){
  if(kcal==null||!Number.isFinite(kcal))return '';
  return (kcal*(unit==='kj'?kjPerKcal:1)).toFixed(digits).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
}
export function parseEnergy(value:string,unit:EnergyUnit){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed/(unit==='kj'?kjPerKcal:1):NaN;
}

export function heightPartsFromCm(cm:number){
  const totalInches=cm/2.54;
  const feet=Math.floor(totalInches/12);
  return {feet,inches:Math.round((totalInches-feet*12)*10)/10};
}
export function cmFromHeightParts(feetValue:string,inchesValue:string){
  const feet=Number(feetValue);const inches=Number(inchesValue);
  return Number.isFinite(feet)&&Number.isFinite(inches)?(feet*12+inches)*2.54:NaN;
}
export function displayHeight(cm:number|null|undefined,unit:HeightUnit){
  if(cm==null)return '—';
  if(unit==='cm')return `${number(cm,1)} cm`;
  const parts=heightPartsFromCm(cm);
  return `${parts.feet} ft ${number(parts.inches,1)} in`;
}

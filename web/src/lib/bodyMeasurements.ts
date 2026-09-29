import type {BodyMeasurementKey,PhysiqueAngle} from '../types';

/** One vocabulary for Body records: angles, measurement groups, and labels. */
export const angles:PhysiqueAngle[]=['front','side','back'];
export const angleLabel=(angle:PhysiqueAngle)=>angle[0].toUpperCase()+angle.slice(1);
export const measurementGroups:[string,BodyMeasurementKey[]][]=[
  ['Core',['neckCm','shouldersCm','chestCm','waistCm','hipsCm']],
  ['Arms',['leftBicepsCm','rightBicepsCm','leftForearmCm','rightForearmCm']],
  ['Legs',['leftThighCm','rightThighCm','leftCalfCm','rightCalfCm']]
];
const labels:Record<BodyMeasurementKey,string>={
  neckCm:'Neck',shouldersCm:'Shoulders',chestCm:'Chest',waistCm:'Waist',hipsCm:'Hips',
  leftBicepsCm:'Left biceps',rightBicepsCm:'Right biceps',leftForearmCm:'Left forearm',rightForearmCm:'Right forearm',
  leftThighCm:'Left thigh',rightThighCm:'Right thigh',leftCalfCm:'Left calf',rightCalfCm:'Right calf',bodyFatPercent:'Body fat'
};
export const measurementLabel=(key:BodyMeasurementKey)=>labels[key];
export const circumferenceKeys:BodyMeasurementKey[]=measurementGroups.flatMap(([,keys])=>keys);
export const allMeasurementKeys:BodyMeasurementKey[]=[...circumferenceKeys,'bodyFatPercent'];

/** Keeps a viewer index valid after the list shrinks (a delete or reload). */
export function clampIndex(index:number,length:number){
  if(length<=0)return 0;
  return Math.min(Math.max(index,0),length-1);
}

/**
 * Steps through records ordered newest first. `older` moves toward earlier dates.
 * Returns null at either end so callers can disable the control.
 */
export function stepRecordId(ids:string[],currentId:string,direction:'older'|'newer'){
  const index=ids.indexOf(currentId);
  if(index<0)return null;
  const next=direction==='older'?index+1:index-1;
  return next>=0&&next<ids.length?ids[next]:null;
}

/** Converts an entered circumference to centimetres with the stored one-decimal precision. */
export function toCentimetres(value:number,unit:'cm'|'in'){
  return Math.round((unit==='in'?value*2.54:value)*10)/10;
}

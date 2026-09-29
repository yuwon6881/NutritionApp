import type {BodyMeasurementKey,PhysiqueAngle} from '../types';
import {angles,circumferenceKeys,toCentimetres} from './bodyMeasurements';

/** The part of a Body dialog photo slot that decides whether it can be estimated. */
export type EstimateSlot={angle:PhysiqueAngle;existing?:{id:string;status:string};imageBase64?:string;changed:boolean;deleted:boolean};
export type BodyFatEstimateRequest={
  date:string;
  photos:{angle:PhysiqueAngle;photoId?:string;imageBase64?:string}[];
  measurements:Partial<Record<BodyMeasurementKey,number>>;
};
export type BodyFatEstimateInputs={photos:number;heightCm:number|null;sex:string|null;age:number|null;scaleKg:number|null;trendKg:number|null;measurementKeys:string[]};
export type BodyFatConfidence='low'|'medium'|'high';
export type BodyFatEstimate={
  estimatePercent:number;lowPercent:number;highPercent:number;confidence:BodyFatConfidence;
  explanation:string;cues:string[];formulaPercent:number|null;inputsUsed:BodyFatEstimateInputs;
};

function usablePhoto(slot:EstimateSlot){
  if(slot.changed&&slot.imageBase64)return {angle:slot.angle,imageBase64:slot.imageBase64};
  if(slot.existing&&!slot.deleted&&slot.existing.status==='complete')return {angle:slot.angle,photoId:slot.existing.id};
  return null;
}

function joinAngles(names:PhysiqueAngle[]){
  if(names.length===1)return names[0];
  if(names.length===2)return `${names[0]} and ${names[1]}`;
  return `${names.slice(0,-1).join(', ')}, and ${names.at(-1)}`;
}

/** The estimate button is available only with three usable views and a connection. */
export function estimateReadiness(slots:EstimateSlot[],online:boolean):{ready:boolean;reason:string|null}{
  const missing=angles.filter(angle=>{const slot=slots.find(item=>item.angle===angle);return !slot||!usablePhoto(slot);});
  if(missing.length)return {ready:false,reason:`Add ${joinAngles(missing)} photo${missing.length===1?'':'s'} to estimate.`};
  if(!online)return {ready:false,reason:'Estimating needs a connection.'};
  return {ready:true,reason:null};
}

/** Body fat is what is being estimated, so it is never sent; unreadable entries are left out. */
export function buildEstimateRequest(date:string,slots:EstimateSlot[],values:Record<BodyMeasurementKey,string>,unit:'cm'|'in'):BodyFatEstimateRequest{
  const measurements:Partial<Record<BodyMeasurementKey,number>>={};
  for(const key of circumferenceKeys){
    const raw=values[key].trim();
    const value=Number(raw);
    if(raw!==''&&Number.isFinite(value)&&value>0)measurements[key]=toCentimetres(value,unit);
  }
  const photos=angles.map(angle=>slots.find(slot=>slot.angle===angle)).flatMap(slot=>{const photo=slot&&usablePhoto(slot);return photo?[photo]:[];});
  return {date,photos,measurements};
}

/** Identifies the photos and measurements an estimate was based on, so a later edit can mark it out of date. */
export function requestSignature(request:BodyFatEstimateRequest){
  const photos=request.photos.map(photo=>photo.photoId?`${photo.angle}:${photo.photoId}`:`${photo.angle}:${photo.imageBase64?.length}:${photo.imageBase64?.slice(-32)}`);
  return JSON.stringify([photos,request.measurements]);
}

export const formatRange=(low:number,high:number)=>`${low}–${high}%`;
export const confidenceLabel=(confidence:BodyFatConfidence)=>`${confidence[0].toUpperCase()}${confidence.slice(1)} confidence`;

export function inputsSummary(inputs:BodyFatEstimateInputs){
  const used:string[]=[`${inputs.photos} photos`];const missing:string[]=[];
  const add=(known:boolean,label:string)=>(known?used:missing).push(label);
  add(inputs.heightCm!=null,'height');add(inputs.sex!=null,'sex');add(inputs.age!=null,'age');
  add(inputs.scaleKg!=null,'scale weight');add(inputs.trendKg!=null,'trend weight');
  const count=inputs.measurementKeys.length;
  if(count)used.push(`${count} measurement${count===1?'':'s'}`);else missing.push('measurements');
  return {used,missing};
}

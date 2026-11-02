import type {EnergyEvidence} from '../types';
import {contextAdjustmentSummary} from './weighInEvidence';

export interface CheckInFact {label:string;value:string}

/** One plain sentence for the check-in headline; the full server explanation stays available as detail. */
export function checkInHeadline({holdReason,changed}:{holdReason?:string|null;changed:boolean}):string{
  const hold=holdReason?.trim();
  if(hold)return hold;
  return changed
    ?'Updated from your recent food logs and weigh-ins.'
    :'Your estimated needs barely moved, so your target stays the same.';
}

/** Scannable evidence behind a check-in. Missing evidence yields no row rather than a zero. */
export function checkInFacts(evidence:EnergyEvidence|null|undefined,kcalUnit:string):CheckInFact[]{
  if(!evidence)return [];
  const facts:CheckInFact[]=[{label:'Days logged',value:`${evidence.loggedDays} of ${evidence.windowDays}`}];
  const unlogged=evidence.unloggedDays??0;
  if(unlogged>0){
    const mean=evidence.unloggedMeanIntake;
    facts.push({label:'Unlogged days',value:mean==null?`${unlogged}`:`${unlogged}, counted at about ${Math.round(mean/10)*10} ${kcalUnit}/day`});
  }
  facts.push({label:'Weigh-ins used',value:`${evidence.weighIns} over ${evidence.weighInSpanDays} days`});
  const adjusted=contextAdjustmentSummary(evidence);
  if(adjusted)facts.push({label:'Marked weigh-ins',value:adjusted.replace(/\.$/,'')});
  return facts;
}

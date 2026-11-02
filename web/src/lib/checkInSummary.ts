import type {EnergyEvidence} from '../types';

export interface CheckInFigure {label:string;value:string;note?:string}

/** One plain sentence for the check-in headline; the full server explanation stays available as detail. */
export function checkInHeadline({holdReason,changed}:{holdReason?:string|null;changed:boolean}):string{
  const hold=holdReason?.trim();
  if(hold)return hold;
  return changed
    ?'Updated from your recent food logs and weigh-ins.'
    :'Your estimated needs barely moved, so your target stays the same.';
}

/** Headline evidence as short figures. Missing evidence yields no tile rather than a zero. */
export function checkInFigures(evidence:EnergyEvidence|null|undefined,kcalUnit:string):CheckInFigure[]{
  if(!evidence)return [];
  const figures:CheckInFigure[]=[{label:'Days logged',value:`${evidence.loggedDays}/${evidence.windowDays}`}];
  const unlogged=evidence.unloggedDays??0;
  if(unlogged>0){
    const mean=evidence.unloggedMeanIntake;
    figures.push({label:'Unlogged',value:`${unlogged}`,note:mean==null?undefined:`≈ ${Math.round(mean/10)*10} ${kcalUnit}/day`});
  }
  figures.push({label:'Weigh-ins',value:`${evidence.weighIns}`,note:`over ${evidence.weighInSpanDays} days`});
  return figures;
}

export interface CheckInAdjustment {kind:'ignored'|'counted';lead:string;detail:string}

const weighIns=(count:number)=>`${count} weigh-in${count===1?'':'s'}`;

/**
 * What marked weigh-ins did to the estimate, in outcome-first sentences. Weigh-ins merely counted at reduced weight
 * while water settles are a calculation detail the user cannot act on, so they are not listed.
 */
export function checkInAdjustments(evidence:EnergyEvidence|null|undefined):CheckInAdjustment[]{
  const ignored=evidence?.contextExcluded??0;
  const counted=evidence?.contextReinstated??0;
  const lines:CheckInAdjustment[]=[];
  if(ignored>0)lines.push({kind:'ignored',lead:`${weighIns(ignored)} ignored.`,detail:`You marked ${ignored===1?'it':'them'} as temporary, so ${ignored===1?'it':'they'} didn't affect your calories.`});
  if(counted>0)lines.push({kind:'counted',lead:`${weighIns(counted)} counted after all.`,detail:`Your weight stayed at that level, so ${counted===1?'it was':'the change was'} real.`});
  return lines;
}

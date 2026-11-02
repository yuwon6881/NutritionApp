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

/** Short tally of how marked weigh-ins were treated; null when none were adjusted. */
export function checkInAdjustments(evidence:EnergyEvidence|null|undefined):string|null{
  const parts=[
    [evidence?.contextExcluded??0,'left out'],
    [evidence?.contextSettling??0,'counted less'],
    [evidence?.contextReinstated??0,'counted again'],
  ].filter(([count])=>count).map(([count,label])=>`${count} ${label}`);
  return parts.length?`Marked weigh-ins: ${parts.join(' · ')}`:null;
}

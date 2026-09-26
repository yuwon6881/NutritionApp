import {Capacitor} from '@capacitor/core';
import type {Entry} from '../types';
import {displayEnergy,energyLabel,type EnergyUnit} from './units';
import {displayPortion} from './portions';

/**
 * Sharing is only ever started by an explicit tap and only shares text the
 * person can see: the day's totals and food names. Unknown macros are shown
 * as unknown, never as zero.
 */
export function daySummaryText(date:string,entries:readonly Entry[],energyUnit:EnergyUnit):string{
  const unit=energyLabel(energyUnit);
  const total=entries.reduce((sum,entry)=>sum+entry.calories,0);
  const macro=(key:'protein'|'carbs'|'fat')=>entries.some(entry=>entry[key]==null)?'unknown':`${Math.round(entries.reduce((sum,entry)=>sum+(entry[key]??0),0))} g`;
  const lines=entries.map(entry=>`• ${entry.name} (${displayPortion(entry)}): ${displayEnergy(entry.calories,energyUnit)} ${unit}`);
  return [`Food log for ${date}: ${displayEnergy(total,energyUnit)} ${unit}`,`Protein ${macro('protein')} · Carbs ${macro('carbs')} · Fat ${macro('fat')}`,...lines].join('\n');
}

export type ShareOutcome='shared'|'copied'|'cancelled'|'unavailable';

export function canShareText():boolean{
  if(Capacitor.isNativePlatform())return true;
  return typeof navigator!=='undefined'&&(typeof navigator.share==='function'||!!navigator.clipboard?.writeText);
}

export async function shareText(title:string,text:string):Promise<ShareOutcome>{
  try{
    if(Capacitor.isNativePlatform()){
      const {Share}=await import('@capacitor/share');
      await Share.share({title,text,dialogTitle:title});
      return 'shared';
    }
    if(typeof navigator.share==='function'){
      await navigator.share({title,text});
      return 'shared';
    }
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
    return 'unavailable';
  }catch(error){
    return (error as Error)?.name==='AbortError'||/cancel/i.test((error as Error)?.message??'')?'cancelled':'unavailable';
  }
}

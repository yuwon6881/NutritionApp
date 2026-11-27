import {number} from './format';

/**
 * Where one macro stands against its daily target, for the Dashboard's macro rings.
 *
 * - `left` / `over`: grams still to eat, or eaten past the target.
 * - `on`: within half a gram of the target (what rounds to it).
 * - `logged`: no target, so only the eaten grams are known.
 * - `unknown`: no logged food reports the nutrient, so nothing is claimed.
 *
 * `fill` is the share of the ring drawn for what is eaten (0–1); `overflow` is the share past the
 * target, drawn again over the start of a full ring (capped at one more lap). Unknown stays empty.
 */
export type MacroStanding={
  kind:'left'|'over'|'on'|'logged'|'unknown';
  /** The figure the ring's centre shows: grams left, over, or logged; null when unknown or on target. */
  grams:number|null;
  fill:number;
  overflow:number;
};

export function macroStanding(value:number|null|undefined,target:number|null|undefined):MacroStanding{
  const known=(n:number|null|undefined):n is number=>n!=null&&Number.isFinite(n);
  if(!known(value))return {kind:'unknown',grams:null,fill:0,overflow:0};
  if(!known(target)||target<=0)return {kind:'logged',grams:value,fill:0,overflow:0};
  const difference=target-value;
  const fill=Math.min(Math.max(value/target,0),1);
  const overflow=Math.min(Math.max(value/target-1,0),1);
  if(Math.abs(difference)<0.5)return {kind:'on',grams:null,fill:1,overflow:0};
  return difference>0
    ?{kind:'left',grams:difference,fill,overflow:0}
    :{kind:'over',grams:-difference,fill,overflow};
}

/** The ring's centre caption for a standing, kept short enough for a small ring. */
export function macroStandingCaption(standing:MacroStanding):string{
  switch(standing.kind){
    case 'left':return 'g left';
    case 'over':return 'g over';
    case 'on':return 'On target';
    case 'logged':return 'g eaten';
    default:return 'Not reported';
  }
}

/** One sentence for assistive technology, carrying the true figures the ring draws. */
export function macroStandingLabel(name:string,value:number|null|undefined,target:number|null|undefined):string{
  const standing=macroStanding(value,target);
  if(standing.kind==='unknown')return `${name}: no logged food reports it`;
  const eaten=`${number(value)} g eaten`;
  if(standing.kind==='logged')return `${name}: ${eaten}, no target`;
  const of=`${eaten} of ${number(target)} g`;
  if(standing.kind==='on')return `${name}: ${of}, on target`;
  return `${name}: ${of}, ${number(standing.grams)} g ${standing.kind}`;
}

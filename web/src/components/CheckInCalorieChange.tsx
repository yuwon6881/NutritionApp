import {useEffect,useState} from 'react';
import {ArrowDown,ArrowRight,ArrowUp} from 'lucide-react';
import type {EnergyUnit} from '../types';
import {CoachNumber} from './ui/CoachMotion';
import {useReducedMotion} from './ui/Motion';
import {displayEnergy,energyLabel} from '../lib/units';

// The count starts once the sheet's entrance has settled so it is seen rather than missed.
const countDelay=240;
const countDuration=560;

type Direction='up'|'down'|'same'|'none';

/** Count from the active target to the proposal once. Both ends are exact values; only a real change animates. */
function useCalorieCount(previous:number|null|undefined,proposed:number|null|undefined){
  const reduced=useReducedMotion();
  const counts=previous!=null&&proposed!=null&&previous!==proposed&&!reduced;
  const [display,setDisplay]=useState(counts?previous:proposed??previous);
  const [revealed,setRevealed]=useState(!counts);

  useEffect(()=>{
    if(!counts||previous==null||proposed==null){
      setDisplay(proposed??previous);
      setRevealed(true);
      return;
    }
    setDisplay(previous);
    setRevealed(false);
    let frame=0;
    let start:number|null=null;
    const step=(now:number)=>{
      start??=now;
      const progress=Math.min(1,(now-start)/countDuration);
      const eased=1-Math.pow(1-progress,3);
      setDisplay(Math.round(previous+(proposed-previous)*eased));
      if(progress<1)frame=window.requestAnimationFrame(step);
      else setRevealed(true);
    };
    const timer=window.setTimeout(()=>{frame=window.requestAnimationFrame(step);},countDelay);
    return()=>{window.clearTimeout(timer);window.cancelAnimationFrame(frame);};
  },[counts,previous,proposed]);

  return {display,revealed,counts};
}

export function CheckInCalorieChange({previous,proposed,unit}:{previous:number|null|undefined;proposed:number|null|undefined;unit:EnergyUnit}){
  const {display,revealed,counts}=useCalorieCount(previous,proposed);
  const label=energyLabel(unit);
  const final=proposed??previous;
  const delta=previous!=null&&proposed!=null?proposed-previous:null;
  const direction:Direction=delta==null?'none':delta>0?'up':delta<0?'down':'same';
  const amount=delta==null?'':`${displayEnergy(Math.abs(delta),unit)} ${label}`;
  const summary=direction==='up'?`Up ${amount}`:direction==='down'?`Down ${amount}`:'Unchanged';
  const Icon=direction==='up'?ArrowUp:direction==='down'?ArrowDown:ArrowRight;
  // Announce the settled result once; the per-frame count stays out of the accessibility tree.
  const announcement=final==null?'':`New daily calories ${displayEnergy(final,unit)} ${label}. ${direction==='none'?'':`${summary}.`}`;
  return <div className={`check-in-calorie direction-${direction}${revealed?' is-revealed':''}${counts?' is-counted':''}`} data-check-in-calorie>
    <span className="check-in-calorie-label" key={revealed?'new':'current'} aria-hidden="true">{revealed?'New daily calories':'Current daily calories'}</span>
    <div className="check-in-calorie-value" aria-hidden="true">
      <CoachNumber>{displayEnergy(display,unit)}</CoachNumber><span className="unit">{label}</span>
    </div>
    {delta!=null&&<div className="check-in-calorie-change" aria-hidden="true">
      <span className="check-in-calorie-delta"><Icon size={15} strokeWidth={2.4} aria-hidden="true"/>{summary}</span>
      {direction!=='same'&&<small>Was {displayEnergy(previous,unit)} {label}</small>}
    </div>}
    <p className="sr-only" role="status">{revealed?announcement:''}</p>
  </div>;
}

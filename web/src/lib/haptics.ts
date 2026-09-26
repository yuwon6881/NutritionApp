import {Capacitor} from '@capacitor/core';
import {Haptics,ImpactStyle,NotificationType} from '@capacitor/haptics';

/**
 * Short tactile confirmation for touch gestures and completed actions.
 * Native haptics in the Android app, vibration on the web. Silent when the
 * person turned it off on this device, prefers reduced motion, or the
 * platform has no vibration.
 */
export type HapticKind='selection'|'success';

const KEY='nourish-haptics';

export function hapticsEnabled():boolean{
  try{return localStorage.getItem(KEY)!=='off';}catch{return true;}
}

export function setHapticsEnabled(enabled:boolean){
  try{
    if(enabled)localStorage.removeItem(KEY);
    else localStorage.setItem(KEY,'off');
  }catch{/* Without storage the default (on) applies for this session. */}
}

function reducedMotion(){
  return typeof window!=='undefined'&&!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function hapticTick(kind:HapticKind='selection'){
  if(!hapticsEnabled()||reducedMotion())return;
  if(Capacitor.isNativePlatform()){
    const feedback=kind==='success'?Haptics.notification({type:NotificationType.Success}):Haptics.impact({style:ImpactStyle.Light});
    void feedback.catch(()=>{});
    return;
  }
  if(typeof navigator==='undefined'||!('vibrate' in navigator))return;
  try{navigator.vibrate(kind==='success'?[20,40,20]:35);}catch{/* Vibration is optional feedback. */}
}

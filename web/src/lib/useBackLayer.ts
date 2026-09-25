import {useEffect,useRef} from 'react';
import {backCoordinator} from './appHistory';

/**
 * While `active`, the device/browser Back gesture calls `onBack` instead of
 * leaving the current page. Use for surfaces lighter than a Modal (which owns
 * its own history entry): selection mode, dialog steps, popovers.
 */
export function useBackLayer(active:boolean,onBack:()=>void){
  const onBackRef=useRef(onBack);
  useEffect(()=>{onBackRef.current=onBack;},[onBack]);
  useEffect(()=>{
    if(!active||typeof window==='undefined')return;
    return backCoordinator().register(()=>onBackRef.current());
  },[active]);
}

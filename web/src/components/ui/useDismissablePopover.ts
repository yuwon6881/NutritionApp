import {useEffect,useRef,type RefObject} from 'react';
import {useBackLayer} from '../../lib/useBackLayer';

/**
 * Closes an open popover when a pointer — mouse, pen, or touch — goes down
 * outside every element in `inside`, or when the person presses Back.
 */
export function useDismissablePopover(isOpen:boolean,inside:ReadonlyArray<RefObject<HTMLElement|null>>,onDismiss:()=>void){
  const onDismissRef=useRef(onDismiss);
  const insideRef=useRef(inside);
  useEffect(()=>{onDismissRef.current=onDismiss;insideRef.current=inside;});

  useEffect(()=>{
    if(!isOpen)return;
    const handlePointerDown=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(insideRef.current.some(ref=>ref.current?.contains(target)))return;
      onDismissRef.current();
    };
    document.addEventListener('pointerdown',handlePointerDown);
    return()=>document.removeEventListener('pointerdown',handlePointerDown);
  },[isOpen]);

  useBackLayer(isOpen,()=>onDismissRef.current());
}

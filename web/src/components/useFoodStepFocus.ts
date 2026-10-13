import {useLayoutEffect,type RefObject} from 'react';

/** Focus the live destination while outgoing food-dialog content may still be mounted. */
export function useFoodStepFocus(open:boolean,step:string,tab:string,selectionFocus?:RefObject<HTMLElement|null>){
  useLayoutEffect(()=>{
    if(!open)return;
    const frame=window.requestAnimationFrame(()=>{
      // The outgoing step can still be mounted during its fade, so the batch step names its own target.
      const retained=step==='selection'?selectionFocus?.current:null;
      // Selection remounts after a review, so the row's stable identity restores its new element.
      const row=retained?.dataset.foodKey
        ?[...document.querySelectorAll<HTMLElement>('.food-modal [data-food-key]')].find(element=>element.dataset.foodKey===retained.dataset.foodKey)
        :undefined;
      const target=retained?.isConnected?retained:row??document.querySelector<HTMLElement>(step==='batch'?'.food-modal [data-step-focus]':'.food-modal [data-modal-autofocus],.food-modal [data-validation-focus]');
      if(step==='selection'&&selectionFocus)selectionFocus.current=null;
      if(target?.isConnected)target.focus({preventScroll:true});
    });
    return()=>window.cancelAnimationFrame(frame);
  },[open,step,tab,selectionFocus]);
}

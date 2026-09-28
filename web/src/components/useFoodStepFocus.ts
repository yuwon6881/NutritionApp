import {useLayoutEffect} from 'react';

/** Focus the live destination while outgoing food-dialog content may still be mounted. */
export function useFoodStepFocus(open:boolean,step:string,tab:string){
  useLayoutEffect(()=>{
    if(!open)return;
    const frame=window.requestAnimationFrame(()=>{
      // The outgoing step can still be mounted during its fade, so the batch step names its own target.
      const target=document.querySelector<HTMLElement>(step==='batch'?'.food-modal [data-step-focus]':'.food-modal [data-modal-autofocus],.food-modal [data-validation-focus]');
      if(target?.isConnected)target.focus({preventScroll:true});
    });
    return()=>window.cancelAnimationFrame(frame);
  },[open,step,tab]);
}

import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {useReducedMotion} from './Motion';

/** Commit the next live form immediately; animation never gates its controls or focus. */
export function useCoachSteps<T extends string>(initial:T,order:readonly T[],scene:string){
  const reduceMotion=useReducedMotion();
  const [step,setStep]=useState(initial);
  const stage=useRef<HTMLDivElement>(null);
  const desired=useRef(initial);
  const current=useRef(initial);
  const direction=useRef(1);
  const animation=useRef<Animation|undefined>(undefined);
  const navigated=useRef(false);
  const go=(next:T)=>{
    if(next===desired.current){
      if(next===current.current)return;
      animation.current?.cancel();
      navigated.current=true;
      current.current=next;
      setStep(next);
      return;
    }
    desired.current=next;
    direction.current=Math.sign(order.indexOf(next)-order.indexOf(current.current));
    animation.current?.cancel();
    if(next===current.current)return;
    navigated.current=true;
    current.current=next;
    setStep(next);
  };
  useLayoutEffect(()=>{
    animation.current?.cancel();
    if(!navigated.current||!stage.current)return;
    const focusHeading=()=>{
      const heading=stage.current?.querySelector<HTMLElement>('[data-step-heading]');
      heading?.focus({preventScroll:true});
      if(heading&&heading.getBoundingClientRect().top<0)heading.scrollIntoView({block:'nearest'});
    };
    focusHeading();
    // Media-query changes can land in the same frame as a programmatic step
    // click. Reassert the destination focus only if focus left the step stage,
    // never stealing focus from a control the user or test already focused.
    const focusFrame=window.requestAnimationFrame(()=>{
      if(!stage.current?.contains(document.activeElement))focusHeading();
    });
    if(!reduceMotion)animation.current=stage.current.animate([{opacity:0,transform:`translateX(${direction.current*24}px)`},{opacity:1,transform:'translateX(0)'}],{duration:direction.current<0?140:180,easing:'cubic-bezier(.2,.8,.2,1)'});
    return()=>window.cancelAnimationFrame(focusFrame);
  },[step,scene,reduceMotion]);
  useEffect(()=>{
    if(reduceMotion){
      animation.current?.cancel();
      if(desired.current!==current.current){navigated.current=true;current.current=desired.current;setStep(desired.current);}
    }
  },[reduceMotion]);
  useEffect(()=>()=>{animation.current?.cancel();},[]);
  return {step,go,stage};
}

/** Animate the wrapper, never clip the live controls or their popovers. */
export function CoachLayout({children,className=''}:{children:ReactNode;className?:string}){
  return <div className={className}><div className="coach-layout-content">{children}</div></div>;
}

export function CoachWait({label,active=true}:{label:string;active?:boolean}){
  const [indicator,setIndicator]=useState(false);
  const [slow,setSlow]=useState(false);
  useEffect(()=>{
    setIndicator(false);setSlow(false);
    if(!active)return;
    const reveal=setTimeout(()=>setIndicator(true),180);
    const delay=setTimeout(()=>setSlow(true),8000);
    return()=>{clearTimeout(reveal);clearTimeout(delay);};
  },[active,label]);
  return <div className="coach-wait" role="status">
    {active&&<span className={`coach-wait-arc${indicator?' ready':''}`} aria-hidden="true"/>}
    <span>{label}{slow&&active&&<small>Taking longer than usual.</small>}</span>
  </div>;
}

/** Values are exact immediately; emphasize only once a burst of input settles. */
export function CoachNumber({children}:{children:ReactNode}){
  return <span className="coach-number">{children}</span>;
}

import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {useReducedMotion} from './Motion';

/** One live form: navigation animates out before replacing its contents. */
export function useCoachSteps<T extends string>(initial:T,order:readonly T[],scene:string){
  const reduceMotion=useReducedMotion();
  const [step,setStep]=useState(initial);
  const stage=useRef<HTMLDivElement>(null);
  const desired=useRef(initial);
  const current=useRef(initial);
  const direction=useRef(1);
  const animation=useRef<Animation|undefined>(undefined);
  const sequence=useRef(0);
  const navigated=useRef(false);
  const go=(next:T)=>{
    if(next===desired.current){
      // A quick second navigation can cancel the previous exit before its
      // promise settles. Do not leave the visual step behind the requested one.
      if(next===current.current)return;
      animation.current?.cancel();
      navigated.current=true;
      current.current=next;
      setStep(next);
      return;
    }
    desired.current=next;
    const token=++sequence.current;
    direction.current=Math.sign(order.indexOf(next)-order.indexOf(current.current));
    animation.current?.cancel();
    // Returning to the still-visible step during its exit must not leave it transparent.
    if(next===current.current)return;
    const finish=()=>{
      if(token!==sequence.current)return;
      navigated.current=true;
      current.current=next;
      setStep(next);
    };
    if(!stage.current||reduceMotion){finish();return;}
    const exit=stage.current.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:`translateX(${-direction.current*12}px)`}],{duration:80,easing:'ease-in',fill:'forwards'});
    animation.current=exit;
    void exit.finished.then(finish,()=>{});
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
    // click. Reassert the destination focus after that browser event settles.
    const focusFrame=window.requestAnimationFrame(focusHeading);
    if(!reduceMotion)animation.current=stage.current.animate([{opacity:0,transform:`translateX(${direction.current*24}px)`},{opacity:1,transform:'translateX(0)'}],{duration:direction.current<0?140:180,easing:'cubic-bezier(.2,.8,.2,1)'});
    return()=>window.cancelAnimationFrame(focusFrame);
  },[step,scene,reduceMotion]);
  useEffect(()=>{
    if(reduceMotion){
      animation.current?.cancel();
      if(desired.current!==current.current){navigated.current=true;current.current=desired.current;setStep(desired.current);}
    }
  },[reduceMotion]);
  useEffect(()=>()=>{++sequence.current;animation.current?.cancel();},[]);
  return {step,go,stage};
}

/** Animate the wrapper, never clip the live controls or their popovers. */
export function CoachLayout({children,className=''}:{children:ReactNode;className?:string}){
  const reduced=useReducedMotion();
  const outer=useRef<HTMLDivElement>(null);
  const inner=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const node=outer.current,content=inner.current;
    if(!node||!content)return;
    let height=content.getBoundingClientRect().height;
    let animation:Animation|undefined;
    const observer=new ResizeObserver(()=>{
      const next=content.getBoundingClientRect().height;
      if(Math.abs(next-height)<1)return;
      const from=animation?.playState==='running'?node.getBoundingClientRect().height:height;
      animation?.cancel();
      if(!reduced)animation=node.animate([{height:`${from}px`},{height:`${next}px`}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
      height=next;
    });
    if(reduced)animation?.cancel();
    observer.observe(content);
    return()=>{observer.disconnect();animation?.cancel();};
  },[reduced]);
  return <div ref={outer} className={className}><div ref={inner} className="coach-layout-content">{children}</div></div>;
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
  const reduced=useReducedMotion();
  const node=useRef<HTMLSpanElement>(null);
  const first=useRef(true);
  useEffect(()=>{
    if(first.current){first.current=false;return;}
    let animation:Animation|undefined;
    const timer=setTimeout(()=>{
      if(node.current&&!reduced)animation=node.current.animate([{opacity:.55,transform:'translateY(2px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'ease-out'});
    },120);
    return()=>{clearTimeout(timer);animation?.cancel();};
  },[children,reduced]);
  return <span ref={node} className="coach-number">{children}</span>;
}

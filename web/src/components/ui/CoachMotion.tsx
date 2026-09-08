import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';

const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One live form: navigation animates out before replacing its contents. */
export function useCoachSteps<T extends string>(initial:T,order:readonly T[],scene:string){
  const [step,setStep]=useState(initial);
  const stage=useRef<HTMLDivElement>(null);
  const desired=useRef(initial);
  const current=useRef(initial);
  const direction=useRef(1);
  const animation=useRef<Animation|undefined>(undefined);
  const sequence=useRef(0);
  const navigated=useRef(false);
  const go=(next:T)=>{
    if(next===desired.current)return;
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
    if(!stage.current||reduced()){finish();return;}
    const exit=stage.current.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:`translateX(${-direction.current*12}px)`}],{duration:80,easing:'ease-in',fill:'forwards'});
    animation.current=exit;
    void exit.finished.then(finish,()=>{});
  };
  useLayoutEffect(()=>{
    animation.current?.cancel();
    if(!navigated.current||!stage.current)return;
    const heading=stage.current.querySelector<HTMLElement>('[data-step-heading]');
    heading?.focus({preventScroll:true});
    if(heading&&heading.getBoundingClientRect().top<0)heading.scrollIntoView({block:'nearest'});
    if(!reduced())animation.current=stage.current.animate([{opacity:0,transform:`translateX(${direction.current*24}px)`},{opacity:1,transform:'translateX(0)'}],{duration:direction.current<0?140:180,easing:'cubic-bezier(.2,.8,.2,1)'});
  },[step,scene]);
  useEffect(()=>{
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop=()=>{if(preference.matches){animation.current?.cancel();if(desired.current!==current.current){navigated.current=true;current.current=desired.current;setStep(desired.current);}}};
    preference.addEventListener('change',stop);
    return()=>{++sequence.current;animation.current?.cancel();preference.removeEventListener('change',stop);};
  },[]);
  return {step,go,stage};
}

/** Animate the wrapper, never clip the live controls or their popovers. */
export function CoachLayout({children,className=''}:{children:ReactNode;className?:string}){
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
      if(!reduced())animation=node.animate([{height:`${from}px`},{height:`${next}px`}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
      height=next;
    });
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop=()=>{if(preference.matches)animation?.cancel();};
    observer.observe(content);preference.addEventListener('change',stop);
    return()=>{observer.disconnect();animation?.cancel();preference.removeEventListener('change',stop);};
  },[]);
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
  const node=useRef<HTMLSpanElement>(null);
  const first=useRef(true);
  useEffect(()=>{
    if(first.current){first.current=false;return;}
    let animation:Animation|undefined;
    const timer=setTimeout(()=>{
      if(node.current&&!reduced())animation=node.current.animate([{opacity:.55,transform:'translateY(2px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'ease-out'});
    },120);
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop=()=>{if(preference.matches)animation?.cancel();};
    preference.addEventListener('change',stop);
    return()=>{clearTimeout(timer);animation?.cancel();preference.removeEventListener('change',stop);};
  },[children]);
  return <span ref={node} className="coach-number">{children}</span>;
}

export function CoachStepper({active,children}:{active:string;children:ReactNode}){
  const nav=useRef<HTMLElement>(null);
  const marker=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{
    const container=nav.current,indicator=marker.current;
    if(!container||!indicator)return;
    const measure=()=>{
      const selected=container.querySelector<HTMLElement>('.step-pill.active');
      if(!selected)return;
      indicator.style.width=`${selected.offsetWidth}px`;
      indicator.style.height=`${selected.offsetHeight}px`;
      indicator.style.transform=`translate(${selected.offsetLeft}px,${selected.offsetTop}px)`;
    };
    measure();
    const observer=new ResizeObserver(measure);observer.observe(container);
    return()=>observer.disconnect();
  },[active]);
  return <nav ref={nav} className="guided-stepper coach-stepper" aria-label="Plan steps"><span ref={marker} className="coach-step-marker" aria-hidden="true"/>{children}</nav>;
}

import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';

const ease='cubic-bezier(.2,.8,.2,1)';

/** A single reactive reduced-motion preference shared by CSS and JS motion. */
export function useReducedMotion(){
  const [reduced,setReduced]=useState(()=>
    typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(()=>{
    if(typeof window==='undefined')return;
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setReduced(media.matches);
    update();
    media.addEventListener('change',update);
    return()=>media.removeEventListener('change',update);
  },[]);

  return reduced;
}

/** Animate a committed page after navigation. The destination is already live and interactive. */
export function MotionScene({sceneKey,children,className=''}:{sceneKey:string;children:ReactNode;className?:string}){
  const scene=useRef<HTMLDivElement>(null);
  const reduced=useReducedMotion();
  const first=useRef(true);

  useLayoutEffect(()=>{
    const node=scene.current;
    if(!node)return;
    const heading=node.querySelector<HTMLElement>('[data-page-heading]');
    heading?.focus({preventScroll:true});
    if(first.current){
      first.current=false;
      return;
    }
    if(reduced)return;
    const animation=node.animate(
      [{opacity:0,transform:'translateY(16px)'},{opacity:1,transform:'translateY(0)'}],
      {duration:240,easing:ease,fill:'both'}
    );
    animation.onfinish=()=>{
      // Do not leave a transform on the scene after the entrance settles. A
      // persistent transform creates a stacking context and can put anchored
      // date/select popovers behind the mobile navigation.
      node.style.removeProperty('opacity');
      node.style.removeProperty('transform');
    };
    return()=>{
      animation.cancel();
      node.style.removeProperty('opacity');
      node.style.removeProperty('transform');
    };
  },[sceneKey,reduced]);

  return <div ref={scene} className={`motion-scene ${className}`.trim()} data-motion-scene={sceneKey}>{children}</div>;
}

/** A bounded tab/panel transition. The content is committed immediately; only its entrance moves. */
export function MotionPanel({motionKey,direction=1,children,className=''}:{motionKey:string;direction?:1|-1;children:ReactNode;className?:string}){
  const panel=useRef<HTMLDivElement>(null);
  const reduced=useReducedMotion();
  const first=useRef(true);
  useLayoutEffect(()=>{
    const node=panel.current;
    if(!node)return;
    if(first.current){first.current=false;return;}
    if(reduced)return;
    const animation=node.animate(
      [{opacity:0,transform:`translateX(${direction*20}px)`},{opacity:1,transform:'translateX(0)'}],
      {duration:180,easing:ease,fill:'both'}
    );
    animation.onfinish=()=>{
      node.style.removeProperty('opacity');
      node.style.removeProperty('transform');
    };
    return()=>{
      animation.cancel();
      node.style.removeProperty('opacity');
      node.style.removeProperty('transform');
    };
  },[motionKey,direction,reduced]);
  return <div ref={panel} className={`motion-panel ${className}`.trim()} data-motion-panel={motionKey}>{children}</div>;
}

/** Moves one selection marker between buttons without changing the button semantics. */
export function SelectionIndicator({active,className='',dataLayout,style,children}:{active:string;className?:string;dataLayout?:string;style?:CSSProperties;children:ReactNode}){
  const root=useRef<HTMLDivElement>(null);
  const marker=useRef<HTMLSpanElement>(null);
  const reduced=useReducedMotion();

  useLayoutEffect(()=>{
    const container=root.current;
    const indicator=marker.current;
    if(!container||!indicator)return;
    const measure=()=>{
      const selected=[...container.querySelectorAll<HTMLElement>('[data-selection-key]')]
        .find(element=>element.dataset.selectionKey===active);
      if(!selected)return;
      indicator.style.width=`${selected.offsetWidth}px`;
      indicator.style.height=`${selected.offsetHeight}px`;
      indicator.style.transform=`translate(${selected.offsetLeft}px,${selected.offsetTop}px)`;
    };
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener('resize',measure);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[active]);

  return <div ref={root} className={`selection-indicator ${className}`.trim()} data-layout={dataLayout} data-motion-reduced={reduced||undefined} style={style}>
    <span ref={marker} className="selection-indicator-marker" aria-hidden="true"/>
    {children}
  </div>;
}

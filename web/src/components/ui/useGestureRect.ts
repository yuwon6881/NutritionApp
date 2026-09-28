import {useEffect,useRef,type RefObject} from 'react';

/** Reuse layout reads until scrolling/resizing changes the gesture coordinate space. */
export function useGestureRect<T extends Element>(target:RefObject<T|null>) {
  const rect=useRef<DOMRect|null>(null);
  const observerRef=useRef<ResizeObserver|null>(null);
  const observed=useRef<T|null>(null);
  useEffect(()=>{
    const invalidate=()=>{rect.current=null;};
    window.addEventListener('resize',invalidate);
    window.addEventListener('scroll',invalidate,true);
    const observer=new ResizeObserver(invalidate);
    observerRef.current=observer;
    if(target.current){observer.observe(target.current);observed.current=target.current;}
    return()=>{observer.disconnect();observerRef.current=null;observed.current=null;window.removeEventListener('resize',invalidate);window.removeEventListener('scroll',invalidate,true);};
  },[target]);
  return {
    read:()=>{
      if(observed.current!==target.current){
        observerRef.current?.disconnect();
        if(target.current)observerRef.current?.observe(target.current);
        observed.current=target.current;rect.current=null;
      }
      return rect.current??(rect.current=target.current?.getBoundingClientRect()??null);
    },
    invalidate:()=>{rect.current=null;}
  };
}

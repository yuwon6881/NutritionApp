import {useLayoutEffect,type RefObject} from 'react';

/**
 * Keeps an open popover placed against its trigger: runs `align` once before paint, then again on
 * window resize, any scroll (captured, so scrolling containers count), visual-viewport changes such as
 * the on-screen keyboard or pinch zoom, and, when `observe` is given, size changes of that element.
 * Each popover keeps its own placement rules; this hook only owns when they are re-applied.
 */
export function useViewportAlign(active:boolean,align:()=>void,observe?:RefObject<HTMLElement|null>){
  useLayoutEffect(()=>{
    if(!active)return;
    align();
    const viewport=window.visualViewport;
    window.addEventListener('resize',align);
    window.addEventListener('scroll',align,true);
    viewport?.addEventListener('resize',align);
    viewport?.addEventListener('scroll',align);
    const target=observe?.current;
    const resize=target&&typeof ResizeObserver!=='undefined'?new ResizeObserver(align):null;
    if(target)resize?.observe(target);
    return()=>{
      window.removeEventListener('resize',align);
      window.removeEventListener('scroll',align,true);
      viewport?.removeEventListener('resize',align);
      viewport?.removeEventListener('scroll',align);
      resize?.disconnect();
    };
    // `align` reads refs at call time, so re-subscribing only when the popover opens or closes is enough.
  },[active]);
}

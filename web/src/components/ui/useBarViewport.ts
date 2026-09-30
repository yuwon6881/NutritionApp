import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import {barSlotWidth,revealScrollLeft,visibleBarCount,visibleRange} from '../../lib/barChart';
import {useFrameTask} from './useFrameTask';
import {useWindowTier} from './useWindowTier';

export type BarViewportEdges={back:boolean;forward:boolean;first:number;last:number};

const reducedMotion=()=>typeof window!=='undefined'&&!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Horizontal viewport for a bar series. Each window tier shows a fixed number
 * of bars; longer series scroll natively (finger on touch screens, arrow
 * buttons on wider windows). Several scrollers may attach — stacked charts of
 * the same series — and they stay aligned. A new series opens on its latest
 * bar; `useRevealBar` keeps the selected bar in view.
 */
export function useBarViewport(count:number){
  const visible=visibleBarCount(useWindowTier());
  const [width,setWidth]=useState(0);
  const scrollers=useRef(new Set<HTMLDivElement>());
  const anchored=useRef('');
  const revealed=useRef(Math.max(0,count-1));
  const [edges,setEdges]=useState<BarViewportEdges>({back:false,forward:false,first:0,last:Math.max(0,count-1)});
  const slot=barSlotWidth(width,count,visible);

  const readEdges=useFrameTask((element:HTMLDivElement)=>{
    const {scrollLeft,clientWidth,scrollWidth}=element;
    const range=visibleRange(scrollLeft,clientWidth,slot,count);
    setEdges(previous=>{
      const next={back:scrollLeft>1,forward:scrollLeft+clientWidth<scrollWidth-1,...range};
      return previous.back===next.back&&previous.forward===next.forward&&previous.first===next.first&&previous.last===next.last?previous:next;
    });
  });

  const attach=useCallback((element:HTMLDivElement|null)=>{
    if(!element)return;
    scrollers.current.add(element);
    const measure=()=>{if(element.clientWidth>0)setWidth(element.clientWidth);};
    const observer=new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return()=>{observer.disconnect();scrollers.current.delete(element);};
  },[]);

  const settle=useCallback(()=>{
    const source=scrollers.current.values().next().value;
    if(source){readEdges.schedule(source);readEdges.flush();}
  },[readEdges]);

  const reveal=useCallback((index:number)=>{
    revealed.current=index;
    if(!slot)return;
    for(const element of scrollers.current){
      const next=revealScrollLeft(index,slot,element.scrollLeft,element.clientWidth);
      if(next!==null)element.scrollLeft=next;
    }
    settle();
  },[slot,settle]);

  // A new series or tier opens on the latest bar; a resize keeps the selected bar in view.
  useLayoutEffect(()=>{
    if(!slot)return;
    const key=`${count}:${visible}`;
    if(anchored.current===key){reveal(revealed.current);return;}
    anchored.current=key;
    for(const element of scrollers.current)element.scrollLeft=element.scrollWidth;
    settle();
  },[count,visible,slot,reveal,settle]);

  const onScroll=(event:React.UIEvent<HTMLDivElement>)=>{
    const source=event.currentTarget;
    for(const element of scrollers.current){
      if(element!==source&&Math.abs(element.scrollLeft-source.scrollLeft)>.5)element.scrollLeft=source.scrollLeft;
    }
    readEdges.schedule(source);
  };

  /** Move about one screen of bars, keeping one bar of overlap for context. */
  const scrollPage=(direction:-1|1)=>{
    const element=scrollers.current.values().next().value;
    if(!element||!slot)return;
    const bars=Math.max(1,Math.floor(element.clientWidth/slot)-1);
    element.scrollBy({left:direction*bars*slot,behavior:reducedMotion()?'instant':'smooth'});
  };

  return {
    slot,
    contentWidth:slot*count,
    scrollable:slot*count>width+1,
    edges,
    reveal,
    scrollPage,
    scrollerProps:{ref:attach,onScroll},
  };
}

export type BarViewport=ReturnType<typeof useBarViewport>;

/**
 * Keep the selected bar on screen when the keyboard or a tap moves the selection.
 * Only a changed index scrolls: a new series briefly keeps its old index before
 * the scrub resets it, and that stale index must not pull the view off the latest bar.
 */
export function useRevealBar(viewport:BarViewport,index:number){
  const {reveal}=viewport;
  const previous=useRef(index);
  useLayoutEffect(()=>{
    if(previous.current===index)return;
    previous.current=index;
    reveal(index);
  },[reveal,index]);
}

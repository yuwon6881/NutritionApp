import {useCallback,useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {Button} from './Button';
import {useReducedMotion} from './Motion';
import './swipe-carousel.css';

export type CarouselSlide={id:string;ariaLabel:string;content:ReactNode};

/** How long after the user's own change a saved value arriving from elsewhere is treated as a stale echo. */
const echoWindowMs=2000;
/** Saving waits for the swiping to stop, so a burst persists once, where the user landed. */
const saveDelayMs=350;
/** How far a finger must travel past the first or last view before the carousel wraps round. */
const wrapSwipePx=56;

/**
 * True when the touched element handles sideways movement itself: a chart that scrolls its bars, or
 * one that scrubs under the finger. A swipe there belongs to the chart and never wraps the carousel.
 */
function ownsSidewaysTouch(target:EventTarget|null,track:HTMLElement){
  for(let node=target instanceof Element?target:null;node&&node!==track;node=node.parentElement){
    const style=window.getComputedStyle(node);
    if(style.touchAction==='pan-y'||style.touchAction==='none')return true;
    if(node.scrollWidth>node.clientWidth+1&&(style.overflowX==='auto'||style.overflowX==='scroll'))return true;
  }
  return false;
}

/**
 * Related views of one measure inside a single card. A finger swipes between them (CSS scroll
 * snap, so the browser owns the gesture) and the pager under the views (an arrow either side of
 * the position dots) does the same for tap, mouse and keyboard. The views form a loop: past the
 * last comes the first, and before the first the last. Only the visible slide is reachable, and
 * the card is as tall as that slide. Charts keep their own horizontal scrolling: swipe outside the
 * plot to change view.
 */
export function SwipeCarousel({label,slides,className='',toolbar,activeId,onChange}:{label:string;slides:readonly CarouselSlide[];className?:string;toolbar?:ReactNode;activeId?:string;onChange?:(id:string)=>void}){
  const reduced=useReducedMotion();
  const trackRef=useRef<HTMLDivElement>(null);
  const slideRefs=useRef<(HTMLDivElement|null)[]>([]);
  const initialIndex=useMemo(()=>{
    if(!activeId)return 0;
    const i=slides.findIndex(s=>s.id===activeId);
    return i>=0?i:0;
  },[activeId,slides]);
  const [active,setActive]=useState(initialIndex);
  const [height,setHeight]=useState<number>();
  const baseId=useId();
  const activeRef=useRef(active);
  activeRef.current=active;
  const onChangeRef=useRef(onChange);
  onChangeRef.current=onChange;
  const resizingUntil=useRef(0);
  const programmaticUntil=useRef(0);
  // The last index this carousel reported or was told about. A late echo of an older saved choice
  // (rapid swiping while settings sync) differs from it and must not pull the view back.
  const reportedRef=useRef(initialIndex);
  const lastUserAt=useRef(Number.NEGATIVE_INFINITY);
  const emitTimer=useRef(0);
  const pendingEmit=useRef<string|undefined>(undefined);
  const navTimer=useRef(0);
  const frame=useRef(0);
  const current=Math.min(Math.max(0,active),slides.length-1);

  const flushEmit=useCallback(()=>{
    window.clearTimeout(emitTimer.current);
    const id=pendingEmit.current;
    pendingEmit.current=undefined;
    if(id!==undefined)onChangeRef.current?.(id);
  },[]);
  const emit=useCallback((id:string)=>{
    lastUserAt.current=performance.now();
    pendingEmit.current=id;
    window.clearTimeout(emitTimer.current);
    emitTimer.current=window.setTimeout(flushEmit,saveDelayMs);
  },[flushEmit]);
  useEffect(()=>flushEmit,[flushEmit]);

  const clearNavigating=useCallback(()=>{
    window.clearTimeout(navTimer.current);
    window.cancelAnimationFrame(frame.current);
    programmaticUntil.current=0;
    const track=trackRef.current;
    if(track)delete track.dataset.navigating;
  },[]);

  const navigateTo=useCallback((index:number,smooth:boolean)=>{
    const track=trackRef.current;
    if(!track||index<0||index>=slides.length)return;
    const width=track.clientWidth;
    if(!width)return;
    window.cancelAnimationFrame(frame.current);
    window.clearTimeout(navTimer.current);
    const target=index*width;
    track.dataset.navigating='true';
    if(!smooth){
      track.scrollTo({left:target,behavior:'instant'});
      programmaticUntil.current=performance.now()+60;
      navTimer.current=window.setTimeout(clearNavigating,60);
      return;
    }
    // A short eased tween: the browser's own smooth scroll is slow and its length is not ours to set.
    const from=track.scrollLeft;
    const duration=Math.min(260,140+Math.abs(target-from)/width*60);
    const start=performance.now();
    programmaticUntil.current=start+duration+80;
    const step=(now:number)=>{
      const t=Math.min(1,(now-start)/duration);
      track.scrollLeft=from+(target-from)*(1-Math.pow(1-t,3));
      if(t<1)frame.current=window.requestAnimationFrame(step);
    };
    frame.current=window.requestAnimationFrame(step);
    // Frames can be starved (a throttled or backgrounded page); the view still lands where it was sent.
    navTimer.current=window.setTimeout(()=>{track.scrollLeft=target;clearNavigating();},duration+80);
  },[slides.length,clearNavigating]);

  useEffect(()=>{
    if(!activeId)return;
    const target=slides.findIndex(s=>s.id===activeId);
    if(target<0||target===reportedRef.current)return;
    if(performance.now()-lastUserAt.current<echoWindowMs)return;
    reportedRef.current=target;
    setActive(target);
    navigateTo(target,!reduced);
  },[activeId,slides,reduced,navigateTo]);

  // While a finger drags, the title, dots and height follow the page most in view.
  const follow=useCallback(()=>{
    const track=trackRef.current;
    if(!track||!track.clientWidth||programmaticUntil.current>performance.now()||resizingUntil.current>performance.now())return;
    const next=Math.round(track.scrollLeft/track.clientWidth);
    if(next>=0&&next<slides.length&&next!==activeRef.current)setActive(next);
  },[slides.length]);

  const settle=useCallback(()=>{
    const track=trackRef.current;
    if(!track||!track.clientWidth)return;
    // While the width is settling a scroll position is not a reading; look again once it has.
    const wait=resizingUntil.current-performance.now();
    if(wait>0){window.setTimeout(()=>settleRef.current(),wait+20);return;}
    const tolerance=Math.max(4,Math.round(track.clientWidth*0.02));
    if(programmaticUntil.current>performance.now()){
      const targetLeft=activeRef.current*track.clientWidth;
      if(Math.abs(track.scrollLeft-targetLeft)>tolerance)return;
      clearNavigating();
    }else if(programmaticUntil.current>0){
      clearNavigating();
    }
    delete track.dataset.navigating;
    const next=Math.round(track.scrollLeft/track.clientWidth);
    if(Math.abs(track.scrollLeft-next*track.clientWidth)>tolerance)return;
    if(next>=0&&next<slides.length){
      setActive(next);
      if(next!==reportedRef.current){
        reportedRef.current=next;
        emit(slides[next].id);
      }
    }
  },[slides,clearNavigating,emit]);
  const settleRef=useRef(settle);
  settleRef.current=settle;
  useEffect(()=>{
    const track=trackRef.current;
    if(!track)return;
    let timer=0;
    let raf=0;
    const onScroll=()=>{
      window.clearTimeout(timer);
      timer=window.setTimeout(settle,60);
      if(!raf)raf=window.requestAnimationFrame(()=>{raf=0;follow();});
    };
    track.addEventListener('scroll',onScroll,{passive:true});
    track.addEventListener('scrollend',settle,{passive:true});
    return()=>{
      window.clearTimeout(timer);
      window.cancelAnimationFrame(raf);
      track.removeEventListener('scroll',onScroll);
      track.removeEventListener('scrollend',settle);
    };
  },[settle,follow]);

  // A resize or rotation changes the slide width: hold the view that was showing rather than let the
  // browser's snap land on a neighbour while the layout settles.
  useEffect(()=>{
    const track=trackRef.current;
    if(!track||typeof ResizeObserver==='undefined')return;
    let width=track.clientWidth;
    if(width>0&&activeRef.current>0){
      track.scrollTo({left:activeRef.current*width,behavior:'instant'});
    }
    const observer=new ResizeObserver(()=>{
      if(track.clientWidth===width)return;
      width=track.clientWidth;
      resizingUntil.current=performance.now()+200;
      track.scrollTo({left:activeRef.current*width,behavior:'instant'});
    });
    observer.observe(track);
    return()=>observer.disconnect();
  },[]);

  // The card follows the height of the slide in view, so a short view leaves no gap below it.
  useEffect(()=>{
    const slide=slideRefs.current[current];
    if(!slide||typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(()=>setHeight(slide.offsetHeight));
    observer.observe(slide);
    setHeight(slide.offsetHeight);
    return()=>observer.disconnect();
  },[current,slides.length]);

  /** Moves by one view in either direction, wrapping round at both ends. */
  const step=(direction:1|-1)=>{
    const count=slides.length;
    if(count<2)return;
    const index=(current+direction+count)%count;
    navigateTo(index,!reduced);
    setActive(index);
    if(index!==reportedRef.current){
      reportedRef.current=index;
      emit(slides[index].id);
    }
  };

  // A finger on the track takes over from any running tween.
  const takeOver=()=>{if(programmaticUntil.current>0)clearNavigating();};

  // The track cannot scroll past its ends, so a swipe that pushes beyond one is read here and wraps.
  const edgeSwipe=useRef<{x:number;y:number}|null>(null);
  const startTouch=(event:React.TouchEvent<HTMLDivElement>)=>{
    takeOver();
    const track=trackRef.current;
    const touch=event.touches[0];
    const atEnd=current===0||current===slides.length-1;
    edgeSwipe.current=track&&touch&&event.touches.length===1&&atEnd&&!ownsSidewaysTouch(event.target,track)
      ?{x:touch.clientX,y:touch.clientY}:null;
  };
  const endTouch=(event:React.TouchEvent<HTMLDivElement>)=>{
    const start=edgeSwipe.current;
    edgeSwipe.current=null;
    const touch=event.changedTouches[0];
    if(!start||!touch)return;
    const dx=touch.clientX-start.x;
    const dy=touch.clientY-start.y;
    if(Math.abs(dx)<wrapSwipePx||Math.abs(dx)<Math.abs(dy)*1.5)return;
    if(dx<0&&current===slides.length-1)step(1);
    else if(dx>0&&current===0)step(-1);
  };
  const previous=slides[(current-1+slides.length)%slides.length];
  const next=slides[(current+1)%slides.length];

  return <div className={`swipe-carousel ${className}`.trim()} role="group" aria-roledescription="carousel" aria-label={label}>
    <div className="swipe-carousel-bar">
      <p className="swipe-carousel-title" aria-live="polite">{slides[current].ariaLabel}</p>
      {toolbar&&<div className="swipe-carousel-toolbar">{toolbar}</div>}
    </div>
    <div ref={trackRef} className="swipe-carousel-track" style={height?{height}:undefined} data-reduced={reduced||undefined}
      onPointerDown={takeOver} onTouchStart={startTouch} onTouchEnd={endTouch} onTouchCancel={()=>{edgeSwipe.current=null;}}>
      {slides.map((slide,index)=><div key={slide.id} ref={element=>{slideRefs.current[index]=element;}}
        className="swipe-carousel-slide" role="group" aria-roledescription="slide" aria-label={`${slide.ariaLabel}, ${index+1} of ${slides.length}`}
        id={`${baseId}-${slide.id}`} inert={index!==current}>
        {slide.content}
      </div>)}
    </div>
    {slides.length>1&&<div className="swipe-carousel-footer">
      <Button variant="tertiary" size="icon" className="swipe-carousel-arrow" aria-label={`Previous view: ${previous.ariaLabel}`} onClick={()=>step(-1)}><ChevronLeft size={18} aria-hidden="true"/></Button>
      <div className="swipe-carousel-dots" aria-hidden="true">{slides.map((slide,index)=><span key={slide.id} className="swipe-carousel-dot" data-active={index===current||undefined}/>)}</div>
      <Button variant="tertiary" size="icon" className="swipe-carousel-arrow" aria-label={`Next view: ${next.ariaLabel}`} onClick={()=>step(1)}><ChevronRight size={18} aria-hidden="true"/></Button>
    </div>}
  </div>;
}

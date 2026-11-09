import {useCallback,useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight,MoveHorizontal} from 'lucide-react';
import {Button} from './Button';
import {useReducedMotion} from './Motion';
import './swipe-carousel.css';

// One swipe teaches the gesture for every carousel, so the hint then retires for the session.
let hasSwiped=false;

export type CarouselSlide={id:string;ariaLabel:string;content:ReactNode};

/**
 * Related views of one measure inside a single card. A finger swipes between them (CSS scroll
 * snap, so the browser owns the gesture); from 640 px the arrows beside the view's name do the
 * same for mouse and keyboard, and below that they stay reachable by keyboard and screen reader
 * only. Dots show the position. Only the visible slide is reachable, and the card is as tall as
 * that slide. Charts keep their own horizontal scrolling: swipe outside the plot to change view.
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
  const [swiped,setSwiped]=useState(hasSwiped);
  const baseId=useId();
  const activeRef=useRef(active);
  activeRef.current=active;
  const onChangeRef=useRef(onChange);
  onChangeRef.current=onChange;
  const resizingUntil=useRef(0);
  const programmaticUntil=useRef(0);
  const userSwiped=useRef(false);
  const current=Math.min(Math.max(0,active),slides.length-1);

  const navTimer=useRef(0);

  const clearNavigating=useCallback(()=>{
    window.clearTimeout(navTimer.current);
    programmaticUntil.current=0;
    const track=trackRef.current;
    if(track)delete track.dataset.navigating;
  },[]);

  const navigateTo=useCallback((index:number,smooth:boolean)=>{
    const track=trackRef.current;
    if(!track||index<0||index>=slides.length)return;
    const width=track.clientWidth;
    if(!width)return;
    programmaticUntil.current=performance.now()+450;
    track.dataset.navigating='true';
    track.scrollTo({left:index*width,behavior:smooth?'smooth':'instant'});
    window.clearTimeout(navTimer.current);
    navTimer.current=window.setTimeout(clearNavigating,450);
  },[slides.length,clearNavigating]);

  useEffect(()=>{
    if(!activeId)return;
    const target=slides.findIndex(s=>s.id===activeId);
    if(target>=0&&target!==activeRef.current){
      setActive(target);
      navigateTo(target,!reduced);
    }
  },[activeId,slides,reduced,navigateTo]);

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
    const ratio=track.scrollLeft/track.clientWidth;
    const next=Math.round(ratio);
    if(Math.abs(track.scrollLeft-next*track.clientWidth)>tolerance)return;
    if(next>=0&&next<slides.length){
      setActive(next);
      if(next!==activeRef.current){
        hasSwiped=true;
        setSwiped(true);
        if(userSwiped.current){
          userSwiped.current=false;
          onChangeRef.current?.(slides[next].id);
        }
      }else{
        userSwiped.current=false;
      }
    }
  },[slides,clearNavigating]);
  const settleRef=useRef(settle);
  settleRef.current=settle;
  useEffect(()=>{
    const track=trackRef.current;
    if(!track)return;
    let timer=0;
    const onScroll=()=>{
      window.clearTimeout(timer);
      timer=window.setTimeout(settle,60);
    };
    track.addEventListener('scroll',onScroll,{passive:true});
    track.addEventListener('scrollend',settle,{passive:true});
    return()=>{
      window.clearTimeout(timer);
      track.removeEventListener('scroll',onScroll);
      track.removeEventListener('scrollend',settle);
    };
  },[settle]);

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

  const go=(index:number)=>{
    const track=trackRef.current;
    if(!track||index<0||index>=slides.length)return;
    navigateTo(index,!reduced);
    setActive(index);
    if(index!==activeRef.current){
      onChangeRef.current?.(slides[index].id);
    }
  };

  const endUserSwipe=()=>void(userSwiped.current=false);

  return <div className={`swipe-carousel ${className}`.trim()} role="group" aria-roledescription="carousel" aria-label={label}>
    <div className="swipe-carousel-bar">
      <Button variant="secondary" size="icon" className="swipe-carousel-arrow" aria-label={`Previous view: ${slides[current-1]?.ariaLabel??''}`} disabled={current===0} onClick={()=>go(current-1)}><ChevronLeft size={18} aria-hidden="true"/></Button>
      <p className="swipe-carousel-title" aria-live="polite">{slides[current].ariaLabel}</p>
      {toolbar&&<div className="swipe-carousel-toolbar">{toolbar}</div>}
      <Button variant="secondary" size="icon" className="swipe-carousel-arrow" aria-label={`Next view: ${slides[current+1]?.ariaLabel??''}`} disabled={current===slides.length-1} onClick={()=>go(current+1)}><ChevronRight size={18} aria-hidden="true"/></Button>
    </div>
    <div ref={trackRef} className="swipe-carousel-track" style={height?{height}:undefined} data-reduced={reduced||undefined}
      onPointerDown={()=>void(userSwiped.current=true)} onTouchStart={()=>void(userSwiped.current=true)}
      onPointerUp={endUserSwipe} onPointerCancel={endUserSwipe} onTouchEnd={endUserSwipe} onTouchCancel={endUserSwipe}>
      {slides.map((slide,index)=><div key={slide.id} ref={element=>{slideRefs.current[index]=element;}}
        className="swipe-carousel-slide" role="group" aria-roledescription="slide" aria-label={`${slide.ariaLabel}, ${index+1} of ${slides.length}`}
        id={`${baseId}-${slide.id}`} inert={index!==current}>
        {slide.content}
      </div>)}
    </div>
    <div className="swipe-carousel-footer" aria-hidden="true">
      <div className="swipe-carousel-dots">{slides.map((slide,index)=><span key={slide.id} className="swipe-carousel-dot" data-active={index===current||undefined}/>)}</div>
      {!swiped&&slides.length>1&&<p className="swipe-carousel-hint"><MoveHorizontal size={14}/>Swipe for more views</p>}
    </div>
  </div>;
}

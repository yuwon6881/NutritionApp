import {useCallback,useEffect,useId,useRef,useState,type ReactNode} from 'react';
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
export function SwipeCarousel({label,slides,className='',toolbar}:{label:string;slides:readonly CarouselSlide[];className?:string;toolbar?:ReactNode}){
  const reduced=useReducedMotion();
  const trackRef=useRef<HTMLDivElement>(null);
  const slideRefs=useRef<(HTMLDivElement|null)[]>([]);
  const [active,setActive]=useState(0);
  const [height,setHeight]=useState<number>();
  const [swiped,setSwiped]=useState(hasSwiped);
  const baseId=useId();
  const activeRef=useRef(0);
  activeRef.current=active;
  const resizingUntil=useRef(0);
  const current=Math.min(active,slides.length-1);

  const settle=useCallback(()=>{
    const track=trackRef.current;
    if(!track||!track.clientWidth)return;
    // While the width is settling a scroll position is not a reading; look again once it has.
    const wait=resizingUntil.current-performance.now();
    if(wait>0){window.setTimeout(()=>settleRef.current(),wait+20);return;}
    const next=Math.round(track.scrollLeft/track.clientWidth);
    setActive(next);
    if(next!==activeRef.current){hasSwiped=true;setSwiped(true);}
  },[]);
  const settleRef=useRef(settle);
  settleRef.current=settle;
  useEffect(()=>{
    const track=trackRef.current;
    if(!track)return;
    let frame=0;
    const onScroll=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(settle);};
    track.addEventListener('scroll',onScroll,{passive:true});
    return()=>{cancelAnimationFrame(frame);track.removeEventListener('scroll',onScroll);};
  },[settle]);

  // A resize or rotation changes the slide width: hold the view that was showing rather than let the
  // browser's snap land on a neighbour while the layout settles.
  useEffect(()=>{
    const track=trackRef.current;
    if(!track||typeof ResizeObserver==='undefined')return;
    let width=track.clientWidth;
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
    track.scrollTo({left:index*track.clientWidth,behavior:reduced?'instant':'smooth'});
    if(reduced)setActive(index);
  };

  return <div className={`swipe-carousel ${className}`.trim()} role="group" aria-roledescription="carousel" aria-label={label}>
    <div className="swipe-carousel-bar">
      <Button variant="secondary" size="icon" className="swipe-carousel-arrow" aria-label={`Previous view: ${slides[current-1]?.ariaLabel??''}`} disabled={current===0} onClick={()=>go(current-1)}><ChevronLeft size={18} aria-hidden="true"/></Button>
      <p className="swipe-carousel-title" aria-live="polite">{slides[current].ariaLabel}</p>
      {toolbar&&<div className="swipe-carousel-toolbar">{toolbar}</div>}
      <Button variant="secondary" size="icon" className="swipe-carousel-arrow" aria-label={`Next view: ${slides[current+1]?.ariaLabel??''}`} disabled={current===slides.length-1} onClick={()=>go(current+1)}><ChevronRight size={18} aria-hidden="true"/></Button>
    </div>
    <div ref={trackRef} className="swipe-carousel-track" style={height?{height}:undefined} data-reduced={reduced||undefined}>
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

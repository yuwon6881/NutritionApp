import type {ScrollBand} from '../lib/dragAutoScroll';

/**
 * DOM side of a diary card drag: a floating copy of the card that follows the
 * pointer, and the visible scroll band used for edge auto-scroll.
 *
 * The copy lives on <body> with fixed positioning because timeline rows use
 * `content-visibility`, whose paint containment would clip a card moved
 * outside its own hour, and because page scrolling must not carry it away
 * from the finger.
 */
export interface DragGhost {
  move:(x:number,y:number)=>void;
  /** Glides back to the card's place (cancelled or no-op drop), then removes itself. */
  returnHome:()=>void;
  remove:()=>void;
}

const SETTLE_MS=180;

function prefersReducedMotion(){
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function createDragGhost(card:HTMLElement,originX:number,originY:number):DragGhost{
  const rect=card.getBoundingClientRect();
  const computed=getComputedStyle(card);
  const ghost=card.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('data-dragging');
  ghost.removeAttribute('data-draggable');
  ghost.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));
  ghost.classList.remove('food-time-card-moved','food-time-card-added','food-time-card-selected');
  ghost.classList.add('food-drag-ghost');
  ghost.setAttribute('aria-hidden','true');
  ghost.inert=true;
  Object.assign(ghost.style,{
    left:`${rect.left}px`,
    top:`${rect.top}px`,
    width:`${rect.width}px`,
    minHeight:`${rect.height}px`,
    padding:computed.padding,
  });
  document.body.appendChild(ghost);

  let removed=false;
  const remove=()=>{
    if(removed)return;
    removed=true;
    ghost.remove();
  };
  return {
    move:(x,y)=>{
      // Keep the copy on screen horizontally; vertical travel is what picks the hour.
      const minDx=8-rect.left;
      const maxDx=window.innerWidth-8-rect.right;
      const dx=Math.min(Math.max(x-originX,Math.min(minDx,0)),Math.max(maxDx,0));
      ghost.style.translate=`${dx}px ${y-originY}px`;
    },
    returnHome:()=>{
      if(removed)return;
      if(prefersReducedMotion()){remove();return;}
      // The card may have scrolled with the page while the copy stayed with the finger.
      const home=card.isConnected?card.getBoundingClientRect():rect;
      ghost.dataset.settling='true';
      ghost.style.translate=`${home.left-rect.left}px ${home.top-rect.top}px`;
      ghost.addEventListener('transitionend',remove,{once:true});
      window.setTimeout(remove,SETTLE_MS+60);
    },
    remove,
  };
}

/** Fixed or sticky chrome hugging the top or bottom edge covers part of the viewport. */
export function visibleScrollBand():ScrollBand{
  const height=window.visualViewport?.height??window.innerHeight;
  let top=0;
  let bottom=height;
  // The phone navigation is a fixed <aside>/.sidebar wrapping a static <nav>, so containers count too.
  document.querySelectorAll<HTMLElement>('header,nav,aside,.sidebar,.food-selection-bar').forEach(element=>{
    const position=getComputedStyle(element).position;
    if(position!=='fixed'&&position!=='sticky')return;
    const rect=element.getBoundingClientRect();
    if(rect.height===0||rect.height>height/3)return;
    if(rect.top<=1&&rect.bottom>top)top=rect.bottom;
    else if(rect.bottom>=height-1&&rect.top<bottom)bottom=rect.top;
  });
  return {top,bottom};
}

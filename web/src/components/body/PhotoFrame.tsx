import type {KeyboardEvent} from 'react';
import {useRecordSwipe} from './useRecordSwipe';

export interface PhotoFrameProps{
  src?:string;
  alt:string;
  emptyTitle:string;
  emptyText:string;
  /** The same angle of the neighbouring record, fetched ahead so stepping does not flash. */
  preloadSrc?:string;
  onOlder?:()=>void;
  onNewer?:()=>void;
}

/**
 * A fixed 3:4 frame so switching records or angles never shifts the layout. The image is keyed
 * by source and fades in with the shared motion token; reduced motion swaps instantly.
 */
export function PhotoFrame({src,alt,emptyTitle,emptyText,preloadSrc,onOlder,onNewer}:PhotoFrameProps){
  const swipe=useRecordSwipe(onOlder,onNewer);
  const navigable=Boolean(onOlder||onNewer);
  const onKeyDown=(event:KeyboardEvent<HTMLDivElement>)=>{
    if(event.key==='ArrowLeft'&&onOlder){event.preventDefault();onOlder();}
    if(event.key==='ArrowRight'&&onNewer){event.preventDefault();onNewer();}
  };
  return <div className="body-photo-frame" data-navigable={navigable||undefined}
    tabIndex={navigable?0:undefined} role={navigable?'group':undefined}
    aria-label={navigable?`${alt}. Left and right arrow keys show older and newer records.`:undefined}
    onKeyDown={navigable?onKeyDown:undefined} {...(navigable?swipe:{})}>
    {src
      ?<img key={src} className="body-photo-frame-image" src={src} alt={alt} decoding="async" draggable={false}/>
      :<div className="photo-slot-empty"><strong>{emptyTitle}</strong><span>{emptyText}</span></div>}
    {preloadSrc&&<img className="photo-adjacent-preload" src={preloadSrc} alt="" aria-hidden="true"/>}
  </div>;
}

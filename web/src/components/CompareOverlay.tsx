import {useId,useRef,useState,type CSSProperties,type PointerEvent} from 'react';
import {Slider} from './ui/Slider';

/**
 * Before/after comparison in one frame: the present photo covers the right
 * share set by the slider. On a phone this keeps both photos at full
 * width instead of two thumbnails stacked far apart.
 */
export function CompareOverlay({pastSrc,presentSrc,pastLabel,presentLabel}:{pastSrc:string;presentSrc:string;pastLabel:string;presentLabel:string}){
  const [reveal,setReveal]=useState(50);
  const id=useId();
  const dragging=useRef(false);
  // Dragging across the photo moves the divider; the slider below stays the keyboard and screen-reader control.
  const moveTo=(event:PointerEvent<HTMLDivElement>)=>{
    const box=event.currentTarget.getBoundingClientRect();
    if(box.width<=0)return;
    const share=Math.min(1,Math.max(0,(event.clientX-box.left)/box.width));
    setReveal(Math.round((1-share)*100));
  };
  return <div className="compare-overlay">
    <div className="compare-overlay-frame"
      onPointerDown={event=>{dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);moveTo(event);}}
      onPointerMove={event=>{if(dragging.current)moveTo(event);}}
      onPointerUp={()=>{dragging.current=false;}} onPointerCancel={()=>{dragging.current=false;}}
      style={{'--split':`${100-reveal}%`} as CSSProperties}>
      <img src={pastSrc} alt={pastLabel} decoding="async"/>
      <img className="compare-overlay-present" src={presentSrc} alt={presentLabel} decoding="async"/>
      <span className="compare-overlay-divider" aria-hidden="true"/>
      <span className="tag past-tag compare-overlay-tag-past" aria-hidden="true">Past</span>
      <span className="tag present-tag compare-overlay-tag-present" aria-hidden="true">Present</span>
    </div>
    <Slider id={`${id}-reveal`} name="compareReveal" label="Present photo shown" value={reveal} min={0} max={100} step={1} formatValue={value=>`${Math.round(value)}%`} onChange={setReveal}/>
  </div>;
}

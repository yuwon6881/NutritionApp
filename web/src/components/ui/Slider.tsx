import {useRef,useCallback,useState,type KeyboardEvent,type PointerEvent,type ReactNode} from 'react';
import {Minus,Plus} from 'lucide-react';
import {FieldFrame} from './Form';
import {circularSliderPoint,circularSliderValue,defaultCircularSliderGeometry} from '../../lib/circularSlider';

export interface SliderProps {
  id: string;
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: ReactNode;
  ariaLabel?: string;
  valueDisplay?: ReactNode;
  formatValue?: (val: number) => string;
  onChange: (value: number) => void;
  className?: string;
  recommendedRange?: [number, number];
  recommendedLabel?: string;
}

export function Slider({
  id,
  name,
  label,
  value,
  min,
  max,
  step = 0.05,
  hint,
  ariaLabel,
  valueDisplay,
  formatValue,
  onChange,
  className = '',
  recommendedRange,
  recommendedLabel
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const clampAndSnap = useCallback((raw: number) => {
    const clamped = Math.min(Math.max(raw, min), max);
    const steps = Math.round((clamped - min) / step);
    const snapped = Number((min + steps * step).toFixed(4));
    return Math.min(Math.max(snapped, min), max);
  }, [min, max, step]);

  const updateFromPointer = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    const rawValue = min + ratio * (max - min);
    const nextValue = clampAndSnap(rawValue);
    if (nextValue !== value) {
      onChange(nextValue);
    }
  }, [min, max, clampAndSnap, value, onChange]);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Primary click only
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    updateFromPointer(e.clientX);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (isDragging.current) {
      isDragging.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture was already released
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next = value;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = clampAndSnap(value + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = clampAndSnap(value - step);
        break;
      case 'PageUp':
        next = clampAndSnap(value + step * 5);
        break;
      case 'PageDown':
        next = clampAndSnap(value - step * 5);
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next !== value) {
      onChange(next);
    }
  };

  const percent = Math.min(Math.max(((value - min) / (max - min)) * 100, 0), 100);
  const formattedText = formatValue ? formatValue(value) : `${value}`;

  const hasRec = recommendedRange && recommendedRange.length === 2;
  const recMinVal = hasRec ? Math.min(recommendedRange[0], recommendedRange[1]) : 0;
  const recMaxVal = hasRec ? Math.max(recommendedRange[0], recommendedRange[1]) : 0;
  const recMinPercent = hasRec
    ? Math.min(Math.max(((recMinVal - min) / (max - min)) * 100, 0), 100)
    : 0;
  const recMaxPercent = hasRec
    ? Math.min(Math.max(((recMaxVal - min) / (max - min)) * 100, 0), 100)
    : 0;
  const recWidth = recMaxPercent - recMinPercent;

  return (
    <FieldFrame label={label} className={`field slider-field ${className}`.trim()}>
      <div className="field-label-row">
        <label htmlFor={id}>{label}</label>
        <div className="slider-value-display">
          {valueDisplay ?? <span className="slider-current-badge">{formattedText}</span>}
        </div>
      </div>

      <div
        id={id}
        ref={trackRef}
        className="custom-slider"
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formattedText}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div className="custom-slider-track">
          {hasRec && (
            <div
              className="custom-slider-zone recommended"
              style={{left: `${recMinPercent}%`, width: `${recWidth}%`}}
              aria-hidden="true"
              title={recommendedLabel ?? 'Recommended range'}
            />
          )}
          <div className="custom-slider-fill" style={{width: `${percent}%`}} />
        </div>
        <div
          className="custom-slider-thumb"
          style={{left: `${percent}%`}}
          aria-hidden="true"
        />
        <input type="hidden" name={name} value={value} />
      </div>

      {hasRec && (
        <div className="slider-range-ticks" aria-hidden="true">
          <span style={{left: `${recMinPercent}%`}} className="tick-mark" />
          <span style={{left: `${recMaxPercent}%`}} className="tick-mark" />
          <div className="tick-label-container" style={{left: `${recMinPercent + recWidth / 2}%`}}>
            <span className="tick-label">{recommendedLabel ? `Recommended: ${recommendedLabel}` : 'Recommended'}</span>
          </div>
        </div>
      )}

      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}

export interface CircularSliderProps {
  id:string;
  name:string;
  label:string;
  value:number;
  min:number;
  max:number;
  step?:number;
  hint?:ReactNode;
  ariaLabel?:string;
  valueDisplay?:ReactNode;
  centerValue?:ReactNode;
  formatValue?:(value:number)=>string;
  validate?:()=>string|undefined;
  onChange:(value:number)=>void;
  className?:string;
  minLabel?:ReactNode;
  maxLabel?:ReactNode;
  showSteppers?:boolean;
}

function circularArcPath(startAngle:number,endAngle:number){
  const start=circularSliderPoint(startAngle);
  const end=circularSliderPoint(endAngle);
  const largeArc=endAngle-startAngle>180?1:0;
  return `M ${start.x} ${start.y} A ${defaultCircularSliderGeometry.radius} ${defaultCircularSliderGeometry.radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function CircularSlider({
  id,
  name,
  label,
  value,
  min,
  max,
  step=1,
  hint,
  ariaLabel,
  valueDisplay,
  centerValue,
  formatValue,
  validate,
  onChange,
  className='',
  minLabel='Min',
  maxLabel='Max',
  showSteppers=true
}:CircularSliderProps){
  const sliderRef=useRef<SVGSVGElement>(null);
  const dragging=useRef(false);
  const [isDragging,setIsDragging]=useState(false);
  const geometry=defaultCircularSliderGeometry;
  const clampAndSnap=useCallback((raw:number)=>{
    const clamped=Math.min(Math.max(raw,min),max);
    const snapped=min+Math.round((clamped-min)/step)*step;
    return Number(Math.min(Math.max(snapped,min),max).toFixed(6));
  },[min,max,step]);

  const updateFromPointer=useCallback((clientX:number,clientY:number,isInitial=false)=>{
    const node=sliderRef.current;
    if(!node)return;
    const rect=node.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return;

    // Ignore clicks in the dead center core on initial pointerdown so tapping center text doesn't jump value
    if(isInitial){
      const x=(clientX-rect.left)/rect.width*geometry.width;
      const y=(clientY-rect.top)/rect.height*geometry.height;
      const dist=Math.hypot(x-geometry.centerX,y-geometry.centerY);
      if(dist<36)return;
    }

    const next=circularSliderValue({x:clientX,y:clientY},rect,min,max,step,geometry);
    if(next!==value)onChange(next);
  },[geometry,max,min,onChange,step,value]);

  const handlePointerDown=(event:PointerEvent<SVGSVGElement>)=>{
    if(event.button!==0)return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current=true;
    setIsDragging(true);
    updateFromPointer(event.clientX,event.clientY,true);
  };
  const handlePointerMove=(event:PointerEvent<SVGSVGElement>)=>{
    if(dragging.current)updateFromPointer(event.clientX,event.clientY,false);
  };
  const handlePointerUp=(event:PointerEvent<SVGSVGElement>)=>{
    dragging.current=false;
    setIsDragging(false);
    if(event.currentTarget.hasPointerCapture(event.pointerId)){
      try{
        event.currentTarget.releasePointerCapture(event.pointerId);
      }catch{
        // Safe ignore
      }
    }
  };

  const stepBy=(multiplier:number)=>{
    const next=clampAndSnap(value+multiplier*step);
    if(next!==value)onChange(next);
  };

  const handleKeyDown=(event:KeyboardEvent<SVGSVGElement>)=>{
    let next=value;
    switch(event.key){
      case 'ArrowRight':
      case 'ArrowUp': next=clampAndSnap(value+step);break;
      case 'ArrowLeft':
      case 'ArrowDown': next=clampAndSnap(value-step);break;
      case 'PageUp': next=clampAndSnap(value+step*5);break;
      case 'PageDown': next=clampAndSnap(value-step*5);break;
      case 'Home': next=min;break;
      case 'End': next=max;break;
      default:return;
    }
    event.preventDefault();
    if(next!==value)onChange(next);
  };

  const percent=max===min?0:Math.min(Math.max((value-min)/(max-min),0),1);
  const thumb=circularSliderPoint(geometry.startAngle+geometry.sweep*percent);
  const path=circularArcPath(geometry.startAngle,geometry.startAngle+geometry.sweep);
  const formatted=formatValue?formatValue(value):`${value}`;
  const formattedMin=formatValue?formatValue(min):`${min}`;
  const formattedMax=formatValue?formatValue(max):`${max}`;
  const startPt=circularSliderPoint(geometry.startAngle);
  const endPt=circularSliderPoint(geometry.startAngle+geometry.sweep);

  return <FieldFrame label={label} validate={validate} className={`field circular-slider-field ${className}`.trim()}>
    <div className="field-label-row">
      <label htmlFor={id}>{label}</label>
      <div className="slider-value-display">{valueDisplay??<span className="slider-current-badge">{formatted}</span>}</div>
    </div>
    <div className={`circular-slider-wrap ${isDragging?'is-dragging':''}`}><svg
      id={id}
      ref={sliderRef}
      className={`circular-slider ${isDragging?'is-dragging':''}`}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel??label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={formatted}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <path className="circular-slider-track" d={path} pathLength="100"/>
      <path className="circular-slider-fill" d={path} pathLength="100" strokeDasharray={`${percent*100} 100`}/>
      <circle className="circular-slider-endpoint start" cx={startPt.x} cy={startPt.y} r="3.5" aria-hidden="true"/>
      <circle className="circular-slider-endpoint end" cx={endPt.x} cy={endPt.y} r="3.5" aria-hidden="true"/>
      <circle className="circular-slider-thumb-halo" cx={thumb.x} cy={thumb.y} r={isDragging?18:13} aria-hidden="true"/>
      <circle className="circular-slider-thumb" cx={thumb.x} cy={thumb.y} r={isDragging?11:9.5}/>
    </svg>{centerValue&&<div className="circular-slider-center" aria-hidden="true">{centerValue}</div>}</div>
    <div className="circular-slider-range" aria-label="Target range bounds and micro-adjustments">
      <button
        type="button"
        className={`circular-slider-bound start ${Math.abs(value-min)<step/2?'is-current':''}`}
        onClick={()=>onChange(min)}
        title={`Set to ${minLabel}: ${formattedMin}`}
      >
        <span className="bound-tag">{minLabel}</span>
        <span className="bound-value">{formattedMin}</span>
      </button>

      {showSteppers&&(
        <div className="circular-slider-steppers" role="group" aria-label="Micro-adjustments">
          <button
            type="button"
            className="slider-stepper-btn"
            onClick={()=>stepBy(-1)}
            disabled={value<=min}
            aria-label={`Decrease by ${step}`}
            title={`Decrease by ${step}`}
          >
            <Minus size={15} aria-hidden="true"/>
          </button>
          <button
            type="button"
            className="slider-stepper-btn"
            onClick={()=>stepBy(1)}
            disabled={value>=max}
            aria-label={`Increase by ${step}`}
            title={`Increase by ${step}`}
          >
            <Plus size={15} aria-hidden="true"/>
          </button>
        </div>
      )}

      <button
        type="button"
        className={`circular-slider-bound end ${Math.abs(value-max)<step/2?'is-current':''}`}
        onClick={()=>onChange(max)}
        title={`Set to ${maxLabel}: ${formattedMax}`}
      >
        <span className="bound-tag">{maxLabel}</span>
        <span className="bound-value">{formattedMax}</span>
      </button>
    </div>
    <input type="hidden" name={name} value={value}/>
    {hint&&<small id={`${id}-hint`}>{hint}</small>}
  </FieldFrame>;
}

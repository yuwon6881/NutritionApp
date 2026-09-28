import {useRef,useCallback,type KeyboardEvent,type ReactNode} from 'react';
import {Minus,Plus} from 'lucide-react';
import {FieldFrame} from './Form';
import {circularSliderPoint,circularSliderValue,defaultCircularSliderGeometry} from '../../lib/circularSlider';
import {usePointerGesture} from './usePointerGesture';

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
  const geometry=defaultCircularSliderGeometry;
  const clampAndSnap=useCallback((raw:number)=>{
    const clamped=Math.min(Math.max(raw,min),max);
    const snapped=min+Math.round((clamped-min)/step)*step;
    return Number(Math.min(Math.max(snapped,min),max).toFixed(6));
  },[min,max,step]);

  const updateFromPointer=useCallback((clientX:number,clientY:number,isInitial=false)=>{
    const node=sliderRef.current;
    if(!node)return;
    const rect=gesture.geometry.read();
    if(!rect)return;
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

  const gesture=usePointerGesture(sliderRef,updateFromPointer);
  const isDragging=gesture.dragging;

  const stepBy=(multiplier:number)=>{
    const next=clampAndSnap(value+multiplier*step);
    if(next!==value)onChange(next);
  };

  const handleKeyDown=(event:KeyboardEvent<SVGSVGElement>)=>{
    gesture.cancel();
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
      <span id={`${id}-label`} className="slider-label">{label}</span>
      <div className="slider-value-display">{valueDisplay??<span className="slider-current-badge">{formatted}</span>}</div>
    </div>
    <div className={`circular-slider-wrap ${isDragging?'is-dragging':''}`}><svg
      id={id}
      ref={sliderRef}
      className={`circular-slider ${isDragging?'is-dragging':''}`}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      role="slider"
      tabIndex={0}
      aria-labelledby={`${id}-label`}
      aria-label={ariaLabel??label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={formatted}
      {...gesture.bind}
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

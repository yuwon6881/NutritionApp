import {useId,useEffect,useLayoutEffect,useRef,useState,type InputHTMLAttributes,type ReactNode,type TextareaHTMLAttributes} from 'react';
import {Select} from './Select';
import {TimePicker} from './TimePicker';
import {TimeInput} from './TimeInput';
import {FieldFrame} from './Form';
import {numericInputMode} from '../../lib/inputMode';
import {numberFieldText} from '../../lib/numberFieldText';

export function Field({
  label,
  hint,
  className = '',
  validate,
  action,
  insideAction,
  labelAction,
  leading,
  autoComplete = 'off',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {label: string; hint?: string; validate?:()=>string|undefined; action?: ReactNode; insideAction?: ReactNode; labelAction?: ReactNode; leading?: ReactNode}) {
  if (props.type === 'time') {
    return (
      <TimeInput
        {...props}
        label={label}
        hint={hint}
        validate={validate}
        className={className}
        action={action}
        insideAction={insideAction}
        labelAction={labelAction}
        leading={leading}
      />
    );
  }
  const generated=useId();
  const id=props.id??generated;
  const name=props.name??props.id??id;
  // Keep unfinished numeric text editable even when callers store numeric values. Typing marks
  // the field until it loses focus, so a value the caller rounds or converts is not echoed back
  // mid-keystroke; a value set while the field is merely focused (autofocus, then data) still shows.
  const [raw,setRaw]=useState(String(props.value??''));
  const typing=useRef(false);
  const latestValue=useRef(props.value);
  latestValue.current=props.value;
  useEffect(()=>{
    if(props.type==='number')setRaw(previous=>numberFieldText(previous,props.value,typing.current));
  },[props.value,props.type]);
  const inputEl = (
    <input {...props} autoComplete={autoComplete} inputMode={props.inputMode??numericInputMode(props)} id={id} name={name} aria-describedby={[props['aria-describedby'],hint?`${id}-hint`:undefined].filter(Boolean).join(' ')||undefined}
      value={props.type==='number'?raw:props.value}
      onChange={event=>{if(props.type==='number'){typing.current=true;setRaw(event.target.value);}props.onChange?.(event);}}
      onBlur={event=>{
        if(typing.current){typing.current=false;setRaw(previous=>numberFieldText(previous,latestValue.current,false));}
        props.onBlur?.(event);
      }}/>
  );
  // `null` keeps the wrapper mounted with an empty slot: an indicator that appears while someone
  // types must not reparent the focused input, or the remount closes the on-screen keyboard.
  // A decorative leading icon (a search glass) sits inside the field's start edge.
  const fieldInput = insideAction !== undefined || leading != null ? (
    <div className={`field-input-wrapper${leading != null ? ' has-leading' : ''}`}>
      {leading != null && <span className="field-leading" aria-hidden="true">{leading}</span>}
      {inputEl}{insideAction != null && <div className="field-inside-action">{insideAction}</div>}
    </div>
  ) : inputEl;
  return (
    <FieldFrame label={label} validate={validate} className={`field ${className}`.trim()}>
      {labelAction ? (
        <div className="field-label-row">
          <label htmlFor={id}>{label}</label>
          {labelAction}
        </div>
      ) : (
        <label htmlFor={id}>{label}</label>
      )}
      {action ? <div className="field-input-row">{fieldInput}{action}</div> : fieldInput}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}

/**
 * A multi-line field that grows with its text and offers no drag handle; past maxHeight it scrolls.
 * The height is measured after each value change, before paint.
 */
export function TextArea({label,hint,maxHeight=320,...props}:TextareaHTMLAttributes<HTMLTextAreaElement>&{label:string;hint?:string;maxHeight?:number}){
  const generated=useId();const id=props.id??generated;const name=props.name??props.id??id;
  const field=useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(()=>{
    const element=field.current;
    if(!element)return;
    element.style.height='auto';
    const border=element.offsetHeight-element.clientHeight;
    const needed=element.scrollHeight+border;
    element.style.height=`${Math.min(needed,maxHeight)}px`;
    element.style.overflowY=needed>maxHeight?'auto':'hidden';
  },[props.value,maxHeight]);
  return <FieldFrame label={label} className="field"><label htmlFor={id}>{label}</label><textarea {...props} ref={field} autoComplete={props.autoComplete ?? 'off'} id={id} name={name} aria-describedby={hint?`${id}-hint`:undefined}/>{hint&&<small id={`${id}-hint`}>{hint}</small>}</FieldFrame>;
}

export {Select, Select as SelectField} from './Select';
export {TimePicker, TimePicker as TimeField} from './TimePicker';
export {TimeInput} from './TimeInput';


import {useId,useEffect,useState,type InputHTMLAttributes,type ReactNode,type TextareaHTMLAttributes} from 'react';
import {Select} from './Select';
import {TimePicker} from './TimePicker';
import {FieldFrame} from './Form';

export function Field({
  label,
  hint,
  className = '',
  validate,
  action,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {label: string; hint?: string; validate?:()=>string|undefined; action?: ReactNode}) {
  const generated=useId();
  const id=props.id??generated;
  const name=props.name??props.id??id;
  // Keep unfinished numeric text editable even when callers store numeric values.
  const [raw,setRaw]=useState(String(props.value??''));
  useEffect(()=>{
    if(props.type==='number')setRaw(previous=>Number(previous)===props.value?previous:String(props.value??''));
  },[props.value,props.type]);
  const inputEl = (
    <input {...props} id={id} name={name} aria-describedby={[props['aria-describedby'],hint?`${id}-hint`:undefined].filter(Boolean).join(' ')||undefined}
      value={props.type==='number'?raw:props.value} onChange={event=>{if(props.type==='number')setRaw(event.target.value);props.onChange?.(event);}}/>
  );
  return (
    <FieldFrame label={label} validate={validate} className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {action ? <div className="field-input-row">{inputEl}{action}</div> : inputEl}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}

export function TextArea({label,hint,...props}:TextareaHTMLAttributes<HTMLTextAreaElement>&{label:string;hint?:string}){
  const generated=useId();const id=props.id??generated;const name=props.name??props.id??id;
  return <FieldFrame label={label} className="field"><label htmlFor={id}>{label}</label><textarea {...props} id={id} name={name} aria-describedby={hint?`${id}-hint`:undefined}/>{hint&&<small id={`${id}-hint`}>{hint}</small>}</FieldFrame>;
}

export {Select, Select as SelectField} from './Select';
export {TimePicker, TimePicker as TimeField} from './TimePicker';

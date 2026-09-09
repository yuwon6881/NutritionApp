import {useId,useLayoutEffect,useRef,useState,type FormHTMLAttributes,type HTMLAttributes,type Ref} from 'react';
import {TriangleAlert} from 'lucide-react';
import {constraintMessage} from '../../lib/validation';

const fields=new WeakMap<HTMLElement,()=>boolean>();

/** Validate only mounted controls in this form/step, in their visual DOM order. */
export function validateFields(root:HTMLElement|null):boolean {
  if(!root)return false;
  let first:HTMLElement|undefined;
  for(const field of root.querySelectorAll<HTMLElement>('[data-validation-field]')){
    if(fields.get(field)?.()===false&&!first)first=field;
  }
  if(first){
    const control=first.querySelector<HTMLElement>('[data-validation-focus],input:not([aria-hidden="true"]),textarea,select:not([aria-hidden="true"])');
    control?.focus({preventScroll:true});
    first.scrollIntoView({block:'nearest',behavior:'instant'});
  }
  return !first;
}

export function Form({onSubmit,children,...props}:FormHTMLAttributes<HTMLFormElement>){
  return <form {...props} noValidate onSubmit={event=>{
    event.preventDefault();
    if(validateFields(event.currentTarget))onSubmit?.(event);
  }}>{children}</form>;
}

type FieldFrameProps=HTMLAttributes<HTMLDivElement>&{
  label:string;
  validate?:()=>string|undefined;
  ref?:Ref<HTMLDivElement>;
};

/** Shared presentation also covers controls whose native input is visually hidden. */
export function FieldFrame({label,validate,ref:externalRef,children,...props}:FieldFrameProps){
  const root=useRef<HTMLDivElement>(null);
  const touched=useRef(false);
  const messageRef=useRef('');
  const [message,setMessage]=useState('');
  const errorId=useId();
  const check=()=>{
    const controls=Array.from(root.current?.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')??[]);
    const enabled=controls.filter(control=>!control.disabled);
    const error=controls.length>0&&enabled.length===0?'':enabled.map(control=>constraintMessage(control,label)).find(Boolean)||validate?.()||'';
    if(messageRef.current!==error){messageRef.current=error;setMessage(error);}
    return !error;
  };
  useLayoutEffect(()=>{
    const element=root.current!;
    fields.set(element,()=>{touched.current=true;return check();});
    if(touched.current)check();
    const targets=element.querySelectorAll<HTMLElement>('[data-validation-focus],input,select,textarea');
    targets.forEach(target=>{
      const descriptions=(target.getAttribute('aria-describedby')??'').split(' ').filter(id=>id&&id!==errorId);
      if(message)descriptions.push(errorId);
      if(descriptions.length)target.setAttribute('aria-describedby',descriptions.join(' '));else target.removeAttribute('aria-describedby');
      if(message)target.setAttribute('aria-invalid','true');else target.removeAttribute('aria-invalid');
    });
    return()=>{fields.delete(element);};
  });
  return <div {...props} ref={element=>{
    root.current=element;
    if(typeof externalRef==='function')externalRef(element);else if(externalRef)externalRef.current=element;
  }} data-validation-field data-invalid={message?true:undefined}
    onBlurCapture={event=>{
      if(!event.currentTarget.contains(event.relatedTarget as Node|null)){touched.current=true;check();}
    }} onChangeCapture={()=>{if(touched.current)queueMicrotask(()=>{if(root.current)check();});}}>
    {children}
    {message&&<small id={errorId} className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true"/>{message}</small>}
  </div>;
}

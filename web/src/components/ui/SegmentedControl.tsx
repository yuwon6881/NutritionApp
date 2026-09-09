import type {ReactNode} from 'react';
import {Button,type ButtonSize} from './Button';

export type SegmentOption<T extends string>={value:T;label:ReactNode;disabled?:boolean};

/** Short choices share a row; longer sets scroll without wrapping on compact screens. */
export function SegmentedControl<T extends string>({label,value,options,onChange,size='md',className='',layout:requestedLayout}:{
  label:string;
  value:T;
  options:readonly SegmentOption<T>[];
  onChange:(value:T)=>void;
  size?:ButtonSize;
  className?:string;
  layout?:'equal'|'scroll';
}){
  const layout=requestedLayout??(options.length<=3?'equal':'scroll');
  return <div className={`segmented-control ${className}`.trim()} role="group" aria-label={label}
    data-layout={layout} style={{gridTemplateColumns:layout==='equal'?`repeat(${options.length}, minmax(0, 1fr))`:undefined}}>
    {options.map(option=><Button key={option.value} type="button" size={size}
      variant={value===option.value?'primary':'secondary'} aria-pressed={value===option.value}
      disabled={option.disabled} onClick={()=>onChange(option.value)}>{option.label}</Button>)}
  </div>;
}

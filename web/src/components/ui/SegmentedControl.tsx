import type {ReactNode} from 'react';
import {Button,type ButtonSize} from './Button';
import {SelectionIndicator} from './Motion';

export type SegmentOption<T extends string>={value:T;label:ReactNode;disabled?:boolean};

/** Short choices share a row; longer sets scroll without wrapping on compact screens. */
export function SegmentedControl<T extends string>({label,value,options,onChange,size='md',className='',layout:requestedLayout,id}:{
  label:string;
  value:T;
  options:readonly SegmentOption<T>[];
  onChange:(value:T)=>void;
  size?:ButtonSize;
  className?:string;
  layout?:'equal'|'scroll';
  id?:string;
}){
  const layout=requestedLayout??(options.length<=3?'equal':'scroll');
  const moveFocus=(index:number,absolute=false)=>{
    const enabled=options.filter(option=>!option.disabled);
    const current=Math.max(0,enabled.findIndex(option=>option.value===value));
    const next=enabled[(absolute?index:current+index+enabled.length)%enabled.length];
    if(next){onChange(next.value);window.requestAnimationFrame(()=>document.getElementById(`${id??'segment'}-${next.value}`)?.focus());}
    else if(enabled[current])onChange(enabled[current].value);
  };
  return <SelectionIndicator active={value} className={`segmented-control ${className}`.trim()} dataLayout={layout}
    style={layout==='equal'?{gridTemplateColumns:`repeat(${options.length}, minmax(0, 1fr))`}:undefined}>
    {options.map(option=><Button key={option.value} id={`${id??'segment'}-${option.value}`} data-selection-key={option.value} type="button" size={size}
      className={value===option.value?'segment-active':undefined}
      variant="secondary" aria-pressed={value===option.value}
      disabled={option.disabled} onClick={()=>onChange(option.value)}
      onKeyDown={event=>{
        if(event.key==='ArrowRight'||event.key==='ArrowDown'){event.preventDefault();moveFocus(1);}
        else if(event.key==='ArrowLeft'||event.key==='ArrowUp'){event.preventDefault();moveFocus(-1);}
        else if(event.key==='Home'){event.preventDefault();moveFocus(0,true);}
        else if(event.key==='End'){event.preventDefault();moveFocus(enabledLength(options),true);}
      }}>{option.label}</Button>)}
  </SelectionIndicator>;
}

function enabledLength<T extends string>(options:readonly SegmentOption<T>[]){
  return options.filter(option=>!option.disabled).length-1;
}

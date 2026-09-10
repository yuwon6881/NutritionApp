import {useLayoutEffect,useState} from 'react';

/** Keep SVG labels at their authored size instead of shrinking a desktop canvas on phones. */
export function useChartLayout(){
  const [element,ref]=useState<SVGSVGElement|null>(null);
  const [width,setWidth]=useState(700);
  useLayoutEffect(()=>{
    if(!element)return;
    const measure=()=>{
      const next=element.getBoundingClientRect().width;
      if(next>0)setWidth(Math.max(240,Math.round(next)));
    };
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(element);
    return()=>observer.disconnect();
  },[element]);
  const left=56;
  const right=width-18;
  return {ref,width,left,right,plotWidth:right-left};
}

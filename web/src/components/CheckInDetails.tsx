import {useId,useState} from 'react';
import {ChevronDown,RotateCw,Scale} from 'lucide-react';
import type {EnergyEvidence} from '../types';
import {Button} from './ui/Button';
import {checkInAdjustments,checkInFigures} from '../lib/checkInSummary';

/** Evidence behind a check-in, collapsed so the headline figure stays the focus. */
export function CheckInDetails({evidence,explanation,kcalUnit}:{evidence:EnergyEvidence|null|undefined;explanation?:string;kcalUnit:string}){
  const [open,setOpen]=useState(false);
  const bodyId=useId();
  const figures=checkInFigures(evidence,kcalUnit);
  const adjustments=checkInAdjustments(evidence);
  // The long explanation is only the fallback when there is no evidence to show as figures.
  const fallback=figures.length?undefined:explanation;
  if(!figures.length&&!fallback)return null;
  return <div className="check-in-details">
    <Button presentation="plain" className="check-in-details-toggle" aria-expanded={open} aria-controls={bodyId} onClick={()=>setOpen(value=>!value)}>
      <span>How this was worked out</span>
      <ChevronDown size={18} aria-hidden="true"/>
    </Button>
    {open&&<div id={bodyId} className="check-in-details-body">
      {figures.length>0&&<dl className="check-in-figures">
        {figures.map(figure=><div key={figure.label}>
          <dt>{figure.label}</dt>
          <dd><strong>{figure.value}</strong>{figure.note&&<small>{figure.note}</small>}</dd>
        </div>)}
      </dl>}
      {adjustments.length>0&&<ul className="check-in-adjustments">
        {adjustments.map(item=>{
          const Icon=item.kind==='ignored'?Scale:RotateCw;
          return <li key={item.kind}><Icon size={16} aria-hidden="true"/><span><strong>{item.lead}</strong> {item.detail}</span></li>;
        })}
      </ul>}
      {fallback&&<p className="check-in-explanation">{fallback}</p>}
    </div>}
  </div>;
}

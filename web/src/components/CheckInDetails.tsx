import {useId,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import type {EnergyEvidence} from '../types';
import {Button} from './ui/Button';
import {checkInFacts} from '../lib/checkInSummary';

/** Evidence behind a check-in, collapsed so the headline figure stays the focus. */
export function CheckInDetails({evidence,explanation,kcalUnit}:{evidence:EnergyEvidence|null|undefined;explanation?:string;kcalUnit:string}){
  const [open,setOpen]=useState(false);
  const bodyId=useId();
  const facts=checkInFacts(evidence,kcalUnit);
  if(!facts.length&&!explanation)return null;
  return <div className="check-in-details">
    <Button presentation="plain" className="check-in-details-toggle" aria-expanded={open} aria-controls={bodyId} onClick={()=>setOpen(value=>!value)}>
      <span>How this was worked out</span>
      <ChevronDown size={18} aria-hidden="true"/>
    </Button>
    {open&&<div id={bodyId} className="check-in-details-body">
      {facts.length>0&&<dl className="check-in-facts">
        {facts.map(fact=><div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl>}
      {explanation&&<p className="check-in-explanation">{explanation}</p>}
    </div>}
  </div>;
}

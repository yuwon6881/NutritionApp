import {useEffect,useId,useState,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
import {Button} from './ui/Button';

/**
 * Keeps the upload and weigh-in import switches out of the way until they are wanted. The collapsed
 * row still states what is on, and a sync problem opens it so the recovery action is never hidden.
 */
export function GoogleHealthSyncOptions({summary,attention,children}:{summary:string;attention:boolean;children:ReactNode}){
  const [open,setOpen]=useState(attention);
  const bodyId=useId();
  useEffect(()=>{if(attention)setOpen(true);},[attention]);
  return <div className="google-health-options">
    <Button presentation="plain" className="google-health-options-toggle" aria-expanded={open} aria-controls={bodyId} onClick={()=>setOpen(value=>!value)}>
      <span>
        <strong>Sync options</strong>
        <small>{summary}</small>
      </span>
      <ChevronDown size={18} aria-hidden="true"/>
    </Button>
    {open&&<div className="google-health-options-body" id={bodyId}>{children}</div>}
  </div>;
}

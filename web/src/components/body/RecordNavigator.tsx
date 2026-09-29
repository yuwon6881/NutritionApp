import {ChevronLeft,ChevronRight} from 'lucide-react';
import {Button} from '../ui/Button';

export interface RecordNavigatorProps{
  /** Singular noun for the position readout, for example "Record" or "Set". */
  noun:string;
  index:number;
  total:number;
  date:string;
  moreOlder?:boolean;
  busy?:boolean;
  onOlder?:()=>void;
  onNewer?:()=>void;
}

/**
 * Steps through dated records in timeline order: older on the leading edge, newer on the
 * trailing edge. Lists are newest first, so index 0 is the newest record.
 */
export function RecordNavigator({noun,index,total,date,moreOlder=false,busy=false,onOlder,onNewer}:RecordNavigatorProps){
  const lower=noun.toLowerCase();
  return <nav className="record-navigator" aria-label={`${noun} navigation`}>
    <Button variant="secondary" className="record-navigator-step" disabled={!onOlder||busy} onClick={onOlder} aria-label={`Older ${lower}`}>
      <ChevronLeft size={18} aria-hidden="true"/><span className="record-navigator-step-label">Older</span>
    </Button>
    <p className="record-navigator-position" aria-live="polite">
      <strong>{date}</strong>
      <span>{noun} {index+1} of {total}{moreOlder?'+':''}</span>
    </p>
    <Button variant="secondary" className="record-navigator-step" disabled={!onNewer||busy} onClick={onNewer} aria-label={`Newer ${lower}`}>
      <span className="record-navigator-step-label">Newer</span><ChevronRight size={18} aria-hidden="true"/>
    </Button>
  </nav>;
}

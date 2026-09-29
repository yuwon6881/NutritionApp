import {ChevronLeft,ChevronRight} from 'lucide-react';
import type {BodyRecord} from '../../types';
import {stepRecordId} from '../../lib/bodyMeasurements';
import {Button} from '../ui/Button';
import {SelectField} from '../ui/Field';

export interface CompareRecordPickerProps{
  /** "Past" or "Present"; names the select and its step buttons. */
  role:'Past'|'Present';
  records:BodyRecord[];
  value:string;
  onChange:(id:string)=>void;
}

/** A date select with one-step older/newer buttons, so either side can walk the timeline. */
export function CompareRecordPicker({role,records,value,onChange}:CompareRecordPickerProps){
  const ids=records.map(record=>record.id);
  const older=stepRecordId(ids,value,'older');
  const newer=stepRecordId(ids,value,'newer');
  const suffix=(index:number)=>index===0?' (latest)':index===records.length-1?' (earliest)':'';
  return <div className="compare-picker-item">
    <div className="compare-picker-row">
      <Button variant="secondary" size="icon" className="compare-picker-step" disabled={!older} onClick={()=>older&&onChange(older)} aria-label={`Older ${role.toLowerCase()} record`}><ChevronLeft size={18} aria-hidden="true"/></Button>
      <SelectField label={`${role} record`} value={value} onChange={onChange}>
        {records.map((record,index)=><option key={record.id} value={record.id}>{`${record.date}${suffix(index)}`}</option>)}
      </SelectField>
      <Button variant="secondary" size="icon" className="compare-picker-step" disabled={!newer} onClick={()=>newer&&onChange(newer)} aria-label={`Newer ${role.toLowerCase()} record`}><ChevronRight size={18} aria-hidden="true"/></Button>
    </div>
  </div>;
}

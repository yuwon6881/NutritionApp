import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Entry} from '../types';
import {normalizeTime,timeLabel} from '../lib/foodDiary';
import {Button} from './ui/Button';
import {DatePicker} from './ui/DatePicker';
import {Field} from './ui/Field';
import {Form} from './ui/Form';
import {Modal} from './ui/Modal';
import {useAsyncAction} from './ui/useAsyncAction';

export interface CopyFoodDialogProps {
  open:boolean;
  entry:Entry;
  currentDate:string;
  onClose:()=>void;
  onCopy:(entry:Entry,date:string,time:string|null)=>Promise<void>|void;
  restoreFocus?:HTMLElement|null;
}

export function CopyFoodDialog({open,entry,currentDate,onClose,onCopy,restoreFocus}:CopyFoodDialogProps){
  const [destinationDate,setDestinationDate]=useState(entry.date);
  const [destinationTime,setDestinationTime]=useState(entry.time??'');
  const [error,setError]=useState('');
  const {busy,run,reset}=useAsyncAction();
  const initial=useRef({date:entry.date,time:entry.time??''});

  useEffect(()=>{
    if(!open)return;
    const next={date:entry.date,time:entry.time??''};
    setDestinationDate(next.date);
    setDestinationTime(next.time);
    setError('');
    initial.current=next;
    reset();
  },[open,entry,reset]);

  const validDate=destinationDate>='2000-01-01'&&destinationDate<=currentDate;
  const submit=async(event?:FormEvent)=>{
    event?.preventDefault();
    if(busy)return;
    const time=normalizeTime(destinationTime);
    if(!validDate){setError('Choose a date from 2000 through today.');return;}
    if(time===undefined){setError('Choose a valid meal time (HH:mm), or leave it blank.');return;}
    setError('');
    try{
      await run(async()=>{await onCopy(entry,destinationDate,time);});
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };
  const copyToToday=async()=>{
    const time=normalizeTime(entry.time);
    if(time===undefined)return;
    setDestinationDate(currentDate);
    setDestinationTime(entry.time??'');
    setError('');
    try{
      await run(async()=>{await onCopy(entry,currentDate,time);});
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };
  const dirty=destinationDate!==initial.current.date||destinationTime!==initial.current.time;

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title="Copy food"
    description={`Copy “${entry.name}” to another date or time.`}
    width="sm"
    dirty={dirty}
  >
    <div className="copy-food-dialog">
      {entry.date!==currentDate&&<div className="action-sheet-options" style={{marginBottom:18}}>
        <Button type="button" variant="secondary" size="lg" className="action-sheet-item" onClick={()=>void copyToToday()} disabled={busy}>
          <span className="action-sheet-item-text">
            <strong>Copy to today</strong>
            <small>{entry.time?`Keep ${timeLabel(entry.time)}`:'Keep time not recorded'}</small>
          </span>
        </Button>
      </div>}
      <Form onSubmit={event=>void submit(event)} className="dialog-form">
        <DatePicker
          id="copy-food-date"
          name="destinationDate"
          label="Copy to date"
          value={destinationDate}
          min="2000-01-01"
          max={currentDate}
          required
          validate={()=>validDate?undefined:'Choose a date from 2000 through today.'}
          onChange={value=>{setDestinationDate(value);setError('');}}
        />
        <Field
          id="copy-food-time"
          name="destinationTime"
          type="time"
          label="Copy to time (optional)"
          hint="Leave blank to keep the entry without a recorded time."
          value={destinationTime}
          onChange={event=>{setDestinationTime(event.target.value);setError('');}}
          validate={()=>destinationTime&&!normalizeTime(destinationTime)?'Choose a valid meal time (HH:mm).':undefined}
        />
        {error&&<p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy?'Copying…':'Copy'}</Button>
        </div>
      </Form>
    </div>
  </Modal>;
}

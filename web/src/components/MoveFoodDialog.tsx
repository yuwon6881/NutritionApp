import {useState,useEffect,useRef,type FormEvent} from 'react';
import type {Entry} from '../types';
import {normalizeTime,moveTargets,timeLabel} from '../lib/foodDiary';
import {Modal} from './ui/Modal';
import {Button} from './ui/Button';
import {DatePicker} from './ui/DatePicker';
import {Field} from './ui/Field';
import {Form} from './ui/Form';
import {useAsyncAction} from './ui/useAsyncAction';

export interface MoveFoodDialogProps {
  open:boolean;
  onClose:()=>void;
  entries:Entry[];
  groups:{time:string;label:string;entries:Entry[]}[];
  currentDate:string;
  onMove:(entries:Entry[],date:string,time:string|null)=>Promise<void>|void;
  restoreFocus?:HTMLElement|null;
}

export function MoveFoodDialog({
  open,
  onClose,
  entries,
  groups,
  currentDate,
  onMove,
  restoreFocus,
}:MoveFoodDialogProps){
  const sourceDate=entries[0]?.date??currentDate;
  const sourceTime=entries[0]?.time??'';
  const [destinationDate,setDestinationDate]=useState(sourceDate);
  const [destinationTime,setDestinationTime]=useState(sourceTime);
  const [error,setError]=useState('');
  const {busy,run,reset}=useAsyncAction();
  const initial=useRef({date:sourceDate,time:sourceTime});

  useEffect(()=>{
    if(!open)return;
    const next={date:entries[0]?.date??currentDate,time:entries[0]?.time??''};
    setDestinationDate(next.date);
    setDestinationTime(next.time);
    setError('');
    initial.current=next;
    reset();
  },[open,entries,currentDate,reset]);

  const validDate=destinationDate>='2000-01-01'&&destinationDate<=currentDate;
  const targets=destinationDate===sourceDate?moveTargets(groups,sourceTime):[];
  const title=entries.length>1?`Move ${entries.length} entries`:entries.length===1?`Move ${entries[0].name}`:'Move entries';

  const submitDestination=async(date:string,time:string|null)=>{
    if(date<'2000-01-01'||date>currentDate){setError('Choose a date from 2000 through today.');return;}
    setError('');
    try{
      await run(async()=>{await onMove(entries,date,time);});
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  const submitForm=async(event:FormEvent)=>{
    event.preventDefault();
    const time=normalizeTime(destinationTime);
    if(!validDate){setError('Choose a date from 2000 through today.');return;}
    if(time===undefined){setError('Choose a valid meal time (HH:mm), or leave it blank.');return;}
    await submitDestination(destinationDate,time);
  };

  const moveToToday=async()=>{
    const time=normalizeTime(sourceTime);
    if(time===undefined){setError('The original meal time is invalid. Choose another time.');return;}
    await submitDestination(currentDate,time);
  };

  const dirty=destinationDate!==initial.current.date||destinationTime!==initial.current.time;

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title={title}
    description="Choose a time on this day or move the entry to another date."
    width="sm"
    dirty={dirty}
  >
    <div className="move-food-dialog">
      {sourceDate!==currentDate&&<div className="action-sheet-options" style={{marginBottom:18}}>
        <Button type="button" variant="secondary" size="lg" className="action-sheet-item" onClick={()=>void moveToToday()} disabled={busy}>
          <span className="action-sheet-item-text">
            <strong>Move to today</strong>
            <small>{sourceTime?`Keep ${timeLabel(sourceTime)}`:'Keep time not recorded'}</small>
          </span>
        </Button>
      </div>}
      {targets.length>0&&<div className="action-sheet-options" style={{marginBottom:18}}>
        {targets.map(target=><Button
          key={target.time}
          type="button"
          variant="secondary"
          size="lg"
          className="action-sheet-item"
          disabled={target.current||busy}
          onClick={()=>void submitDestination(sourceDate,target.time)}
        >
          <span className="action-sheet-item-text">
            <strong>{target.label}</strong>
            <small>{target.current?'Current time':`${target.count} ${target.count===1?'entry':'entries'} already here`}</small>
          </span>
        </Button>)}
      </div>}
      <Form onSubmit={event=>void submitForm(event)}>
        <DatePicker
          id="move-food-date"
          name="destinationDate"
          label="Move to date"
          value={destinationDate}
          min="2000-01-01"
          max={currentDate}
          required
          validate={()=>validDate?undefined:'Choose a date from 2000 through today.'}
          onChange={value=>{setDestinationDate(value);setError('');}}
        />
        <Field
          id="move-food-time"
          name="destinationTime"
          type="time"
          label="Move to time (optional)"
          hint="Leave blank to keep the entry without a recorded time."
          value={destinationTime}
          onChange={event=>{setDestinationTime(event.target.value);setError('');}}
          validate={()=>destinationTime&&!normalizeTime(destinationTime)?'Choose a valid meal time (HH:mm).':undefined}
        />
        {error&&<p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy?'Moving…':'Move'}</Button>
        </div>
      </Form>
    </div>
  </Modal>;
}

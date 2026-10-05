import {useState,useEffect,useRef,type FormEvent} from 'react';
import {Calendar,CalendarPlus,Clock,ChevronRight} from 'lucide-react';
import type {Entry} from '../types';
import {normalizeTime,timeLabel} from '../lib/foodDiary';
import {shiftDate} from '../lib/energyBalance';
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
  groups?:{time:string;label:string;entries:Entry[]}[];
  currentDate:string;
  onMove:(entries:Entry[],date:string,time:string|null|undefined)=>Promise<void>|void;
  restoreFocus?:HTMLElement|null;
}

export function MoveFoodDialog({
  open,
  onClose,
  entries,
  currentDate,
  onMove,
  restoreFocus,
}:MoveFoodDialogProps){
  const sourceDate=entries[0]?.date??currentDate;
  const sourceTime=entries[0]?.time??'';
  const hasMultipleTimes=new Set(entries.map(e=>e.time??'')).size>1;
  const latestDate=shiftDate(currentDate,1);
  const [mode,setMode]=useState<'options'|'custom'>('options');
  const [destinationDate,setDestinationDate]=useState(sourceDate);
  const [destinationTime,setDestinationTime]=useState(sourceTime);
  const [keepOriginalTimes,setKeepOriginalTimes]=useState(hasMultipleTimes);
  const [error,setError]=useState('');
  const {busy,run,reset,pending:busyPending}=useAsyncAction();
  const initial=useRef({date:sourceDate,time:sourceTime});

  useEffect(()=>{
    if(!open)return;
    const next={date:entries[0]?.date??currentDate,time:entries[0]?.time??''};
    setMode('options');
    setDestinationDate(next.date);
    setDestinationTime(next.time);
    setKeepOriginalTimes(hasMultipleTimes);
    setError('');
    initial.current=next;
    reset();
  },[open,entries,currentDate,hasMultipleTimes,reset]);

  const validDate=destinationDate>='2000-01-01'&&destinationDate<=latestDate;
  const title=entries.length>1?`Move ${entries.length} entries`:entries.length===1?`Move ${entries[0].name}`:'Move entries';

  const submitDestination=async(date:string,time:string|null|undefined)=>{
    if(date<'2000-01-01'||date>latestDate){setError('Choose a date from 2000 through tomorrow.');return;}
    setError('');
    try{
      await run(async()=>{await onMove(entries,date,time);});
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  const submitForm=async(event:FormEvent)=>{
    event.preventDefault();
    if(!validDate){setError('Choose a date from 2000 through tomorrow.');return;}
    if(keepOriginalTimes&&destinationDate!==sourceDate){
      await submitDestination(destinationDate,undefined);
      return;
    }
    const time=normalizeTime(destinationTime);
    if(time===undefined){setError('Choose a valid meal time (HH:mm), or leave it blank.');return;}
    await submitDestination(destinationDate,time);
  };

  const moveToToday=async()=>{
    const time=hasMultipleTimes?undefined:normalizeTime(sourceTime);
    if(time===undefined&&!hasMultipleTimes&&sourceTime){setError('The original meal time is invalid. Choose another time.');return;}
    await submitDestination(currentDate,time);
  };

  const moveToTomorrow=async()=>{
    const time=hasMultipleTimes?undefined:normalizeTime(sourceTime);
    if(time===undefined&&!hasMultipleTimes&&sourceTime){setError('The original meal time is invalid. Choose another time.');return;}
    await submitDestination(shiftDate(currentDate,1),time);
  };

  const dirty=mode==='custom'&&(destinationDate!==initial.current.date||destinationTime!==initial.current.time);

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title={mode==='custom'?'Choose date and time':title}
    description={mode==='custom'?'Select a target date and meal time.':'Choose where to move this entry.'}
    width="sm"
    dirty={dirty}
  >
    <div className="move-food-dialog">
      {mode==='options'?(
        <>
          <div className="action-sheet-options" style={{marginBottom:18}}>
            <Button type="button" variant="secondary" size="lg" className="action-sheet-item" onClick={()=>void moveToToday()} disabled={busyPending}>
              <span className="action-sheet-item-icon"><Calendar size={22} aria-hidden="true"/></span>
              <span className="action-sheet-item-text">
                <strong>Move To Today</strong>
                <small>{hasMultipleTimes?'Keep original times for each entry':sourceTime?`Keep ${timeLabel(sourceTime)}`:'Keep time not recorded'}</small>
              </span>
            </Button>
            <Button type="button" variant="secondary" size="lg" className="action-sheet-item" onClick={()=>void moveToTomorrow()} disabled={busyPending}>
              <span className="action-sheet-item-icon"><CalendarPlus size={22} aria-hidden="true"/></span>
              <span className="action-sheet-item-text">
                <strong>Move to tmr</strong>
                <small>{hasMultipleTimes?'Keep original times for each entry':sourceTime?`Keep ${timeLabel(sourceTime)}`:'Keep time not recorded'}</small>
              </span>
            </Button>
            <Button type="button" variant="secondary" size="lg" className="action-sheet-item" onClick={()=>setMode('custom')} disabled={busyPending}>
              <span className="action-sheet-item-icon"><Clock size={22} aria-hidden="true"/></span>
              <span className="action-sheet-item-text">
                <strong>Date and time</strong>
                <small>Choose another date or specific meal time</small>
              </span>
              <ChevronRight size={18} className="action-sheet-item-chevron"/>
            </Button>
          </div>
          {error&&<p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <Button type="button" variant="secondary" fullWidth onClick={onClose} disabled={busyPending}>Cancel</Button>
          </div>
        </>
      ):(
        <Form onSubmit={event=>void submitForm(event)}>
          <DatePicker
            id="move-food-date"
            name="destinationDate"
            label="Move to date"
            value={destinationDate}
            min="2000-01-01"
            max={latestDate}
            required
            validate={()=>validDate?undefined:'Choose a date from 2000 through tomorrow.'}
            onChange={value=>{setDestinationDate(value);setError('');}}
          />
          {entries.length>1&&destinationDate!==sourceDate&&<div className="checks" style={{marginBottom:14}}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={keepOriginalTimes}
                onChange={e=>setKeepOriginalTimes(e.target.checked)}
              />
              <span>Keep original time for each entry</span>
            </label>
          </div>}
          {(!keepOriginalTimes||destinationDate===sourceDate)&&<Field
            id="move-food-time"
            name="destinationTime"
            type="time"
            label="Move to time (optional)"
            hint="Leave blank to keep the entry without a recorded time."
            value={destinationTime}
            onChange={event=>{setDestinationTime(event.target.value);setError('');}}
            validate={()=>destinationTime&&!normalizeTime(destinationTime)?'Choose a valid meal time (HH:mm).':undefined}
          />}
          {error&&<p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <Button type="button" variant="secondary" onClick={()=>setMode('options')} disabled={busyPending}>Back</Button>
            <Button type="submit" variant="primary" disabled={busyPending}>{busy?'Moving…':'Move'}</Button>
          </div>
        </Form>
      )}
    </div>
  </Modal>;
}

import {Form} from './ui/Form';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {NutritionStore} from '../useNutritionStore';
import type {Entry} from '../types';
import {shiftDate} from '../lib/energyBalance';
import {today} from '../lib/format';
import {Button} from './ui/Button';
import {DatePicker} from './ui/DatePicker';
import {Modal} from './ui/Modal';
import {useAsyncAction} from './ui/useAsyncAction';

export interface CopyDayDialogProps {
  open:boolean;
  store:NutritionStore;
  sourceDate:string;
  entries:Entry[];
  onClose:()=>void;
  restoreFocus?:HTMLElement|null;
}

export function CopyDayDialog({open,store,sourceDate,entries,onClose,restoreFocus}:CopyDayDialogProps){
  const [destination,setDestination]=useState(sourceDate);
  const {busy,run,pending:busyPending}=useAsyncAction();
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(0);
  const initial=useRef(sourceDate);
  const current=today(store.state!.profile?.timeZone);

  useEffect(()=>{
    if(!open)return;
    setDestination(sourceDate);setCopied(0);setError('');initial.current=sourceDate;
  },[open,sourceDate]);

  const copy=async(event:FormEvent)=>{
    event.preventDefault();if(busyPending)return;
    if(destination===sourceDate){setError('Choose a different date.');return;}
    setError('');setCopied(0);
    try{
      await run(async()=>{
        await store.logEntries(entries.map(entry=>({...entry,date:destination})));setCopied(entries.length);
      });
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title="Copy day"
    description={`Copy ${entries.length} food ${entries.length===1?'entry':'entries'} from ${sourceDate}.`}
    dirty={destination!==initial.current}
    width="sm"
  >
    <Form onSubmit={copy} className="dialog-form">
      <DatePicker id="copy-to-date" name="destination" validate={()=>destination===sourceDate?'Choose a different date.':undefined} label="Copy to date" value={destination} min="2000-01-01" max={shiftDate(current,1)} required onChange={setDestination}/>
      <p className="source">Food is added to the destination as retained local work and syncs through the existing queue.</p>
      {copied>0&&<p className="notice" role="status">Copied {copied} of {entries.length} entries.</p>}
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions"><Button type="submit" variant="primary" disabled={busyPending||!entries.length}>{busy?'Copying…':'Copy day'}</Button></div>
    </Form>
  </Modal>;
}

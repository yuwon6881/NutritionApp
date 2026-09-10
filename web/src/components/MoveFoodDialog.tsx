import {useState,useEffect} from 'react';
import type {Entry} from '../types';
import {normalizeTime,moveTargets} from '../lib/foodDiary';
import {Modal} from './ui/Modal';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {Form} from './ui/Form';
import {useAsyncAction} from './ui/useAsyncAction';

export interface MoveFoodDialogProps {
  open:boolean;
  onClose:()=>void;
  entries:Entry[];
  groups:{time:string;label:string;entries:Entry[]}[];
  onMove:(entries:Entry[],time:string)=>Promise<void>|void;
  restoreFocus?:HTMLElement|null;
}

export function MoveFoodDialog({
  open,
  onClose,
  entries,
  groups,
  onMove,
  restoreFocus,
}:MoveFoodDialogProps){
  const [customTime,setCustomTime]=useState('');
  const [error,setError]=useState('');
  const {busy,run,reset}=useAsyncAction();

  useEffect(()=>{
    if(open){
      setCustomTime('');
      setError('');
      reset();
    }
  },[open]);

  const fromTime=entries[0]?.time??null;
  const targets=moveTargets(groups,fromTime);
  const title=entries.length>1?`Move ${entries.length} entries`:entries.length===1?`Move ${entries[0].name}`:'Move entries';

  const submitTime=async(time:string)=>{
    const valid=normalizeTime(time);
    if(!valid){
      setError('Choose a valid meal time (HH:mm).');
      return;
    }
    setError('');
    try{
      await run(async()=>{await onMove(entries,valid);});
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title={title}
    width="sm"
    dirty={Boolean(customTime.trim())}
  >
    <div className="move-food-dialog">
      {targets.length>0&&<div className="action-sheet-options" style={{marginBottom:18}}>
        {targets.map(target=><Button
          key={target.time}
          type="button"
          variant="secondary"
          size="lg"
          className="action-sheet-item"
          disabled={target.current||busy}
          onClick={()=>void submitTime(target.time)}
        >
          <span className="action-sheet-item-text">
            <strong>{target.label}</strong>
            <small>{target.current?'Current time':`${target.count} ${target.count===1?'entry':'entries'} already here`}</small>
          </span>
        </Button>)}
      </div>}
      <Form onSubmit={event=>{
        event.preventDefault();
        void submitTime(customTime);
      }}>
        <Field
          id="move-food-custom-time"
          name="customTime"
          type="time"
          label="Choose another time"
          value={customTime}
          onChange={event=>{
            setCustomTime(event.target.value);
            setError('');
          }}
          validate={()=>customTime&&!normalizeTime(customTime)?'Choose a valid meal time (HH:mm).':undefined}
        />
        {error&&<p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy||!customTime.trim()}>{busy?'Moving…':'Move'}</Button>
        </div>
      </Form>
    </div>
  </Modal>;
}

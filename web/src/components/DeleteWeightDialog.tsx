import {useEffect,useState} from 'react';
import type {Weight} from '../types';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {useAsyncAction} from './ui/useAsyncAction';

export interface DeleteWeightDialogProps {
  weight:Weight|null;
  /** The weigh-in formatted in the person's unit, e.g. "72.40 kg". */
  valueLabel:string;
  onClose:()=>void;
  onDelete:(weight:Weight)=>Promise<void>|void;
  restoreFocus?:HTMLElement|null;
}

/** A mis-tap on a phone must not silently remove a recorded weigh-in. */
export function DeleteWeightDialog({weight,valueLabel,onClose,onDelete,restoreFocus}:DeleteWeightDialogProps){
  const [error,setError]=useState('');
  const {busy,run,reset}=useAsyncAction();
  const open=weight!==null;

  useEffect(()=>{
    if(open){setError('');reset();}
  },[open,reset]);

  const remove=async()=>{
    if(!weight)return;
    setError('');
    try{
      await run(async()=>{await onDelete(weight);});
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title="Delete weigh-in"
    ariaDescribedBy="delete-weight-description"
    width="sm"
  >
    <p id="delete-weight-description" className="delete-dialog-text">
      Remove the {valueLabel} weigh-in from {weight?.date}? Your trend and coaching will recalculate without it.
    </p>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="modal-actions">
      <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" variant="destructive" onClick={()=>void remove()} disabled={busy}>{busy?'Deleting…':'Delete'}</Button>
    </div>
  </Modal>;
}

import {useEffect,useState} from 'react';
import type {Entry} from '../types';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {useAsyncAction} from './ui/useAsyncAction';

export interface DeleteFoodDialogProps {
  open:boolean;
  entry:Entry;
  onClose:()=>void;
  onDelete:(entry:Entry)=>Promise<void>|void;
  restoreFocus?:HTMLElement|null;
}

export function DeleteFoodDialog({open,entry,onClose,onDelete,restoreFocus}:DeleteFoodDialogProps){
  const [error,setError]=useState('');
  const {busy,run,reset}=useAsyncAction();

  useEffect(()=>{
    if(open){setError('');reset();}
  },[open,reset]);

  const remove=async()=>{
    setError('');
    try{
      await run(async()=>{await onDelete(entry);});
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title="Delete food"
    description={`Remove “${entry.name}” from the food log? This cannot be undone.`}
    width="sm"
  >
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="modal-actions">
      <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" variant="destructive" onClick={()=>void remove()} disabled={busy}>{busy?'Deleting…':'Delete'}</Button>
    </div>
  </Modal>;
}

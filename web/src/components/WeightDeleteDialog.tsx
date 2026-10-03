import {useState} from 'react';
import type {Weight} from '../types';
import {readoutDate} from '../lib/format';
import {displayWeight,weightLabel,type WeightUnit} from '../lib/units';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {CardFeedback} from './ui/CardFeedback';

export function WeightDeleteDialog({weight,unit,restoreFocus,onClose,onDelete}:{
  weight:Weight;
  unit:WeightUnit;
  restoreFocus:HTMLElement;
  onClose:()=>void;
  onDelete:(weight:Weight)=>Promise<void>;
}){
  const [saving,setSaving]=useState(false);
  const [open,setOpen]=useState(true);
  const [error,setError]=useState('');
  const close=()=>setOpen(false);
  const finishClose=()=>{
    // A confirmed deletion removes its trigger; return to the page heading instead.
    if(!restoreFocus.isConnected)document.querySelector<HTMLElement>('[data-page-heading]')?.focus({preventScroll:true});
    onClose();
  };
  const confirm=async()=>{
    if(saving)return;
    setSaving(true);
    setError('');
    try{
      await onDelete(weight);
      close();
    }catch(ex){
      setError(ex instanceof Error?ex.message:'The weigh-in could not be deleted. Try again.');
    }finally{
      setSaving(false);
    }
  };
  return <Modal open={open} title="Delete weigh-in?" width="sm" restoreFocus={restoreFocus} onClose={close} onCloseComplete={finishClose} preventDismiss={saving}
    description={`${displayWeight(weight.kg,unit,2)} ${weightLabel(unit)} · ${readoutDate(weight.date)}`}>
    <p>This removes the weigh-in from your weight history. You can undo for five seconds after deleting.</p>
    {error&&<CardFeedback title="Weigh-in not deleted" message={error}/>}
    <div className="modal-actions">
      <Button disabled={saving} onClick={close}>Cancel</Button>
      <Button variant="destructive" disabled={saving} onClick={()=>void confirm()}>{saving?'Deleting…':'Delete weigh-in'}</Button>
    </div>
  </Modal>;
}

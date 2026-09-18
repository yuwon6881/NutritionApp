import {useEffect,useState} from 'react';
import type {Entry} from '../types';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {useAsyncAction} from './ui/useAsyncAction';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';
import {displayPortion} from '../lib/portions';

export interface BulkDeleteFoodDialogProps {
  open:boolean;
  entries:Entry[];
  onClose:()=>void;
  onDelete:(entries:Entry[])=>Promise<void>|void;
  restoreFocus?:HTMLElement|null;
  energyUnit?:EnergyUnit;
}

export function BulkDeleteFoodDialog({
  open,
  entries,
  onClose,
  onDelete,
  restoreFocus,
  energyUnit='kcal',
}:BulkDeleteFoodDialogProps){
  const [error,setError]=useState('');
  const {busy,run,reset}=useAsyncAction();

  useEffect(()=>{
    if(open){setError('');reset();}
  },[open,reset]);

  const totalCalories=entries.reduce((sum,e)=>sum+e.calories,0);
  const count=entries.length;

  const removeAll=async()=>{
    setError('');
    try{
      await run(async()=>{await onDelete(entries);});
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  return <Modal
    open={open}
    onClose={onClose}
    restoreFocus={restoreFocus}
    title={`Delete ${count} food ${count===1?'entry':'entries'}`}
    description={`Remove ${count} selected ${count===1?'entry':'entries'} (${displayEnergy(totalCalories,energyUnit)} ${energyLabel(energyUnit)}) from the food log? This cannot be undone.`}
    width="sm"
  >
    <div className="bulk-delete-dialog-list">
      {entries.slice(0,6).map(entry=>(
        <div key={entry.id} className="bulk-delete-item">
          <span className="bulk-delete-item-name">{entry.name}</span>
          <small className="bulk-delete-item-portion">{displayPortion(entry)} · {displayEnergy(entry.calories,energyUnit)} {energyLabel(energyUnit)}</small>
        </div>
      ))}
      {count>6&&<p className="bulk-delete-more">…and {count-6} more {count-6===1?'item':'items'}</p>}
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="modal-actions">
      <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" variant="destructive" onClick={()=>void removeAll()} disabled={busy}>
        {busy?'Deleting…':`Delete ${count} ${count===1?'entry':'entries'}`}
      </Button>
    </div>
  </Modal>;
}

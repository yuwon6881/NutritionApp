import {useMemo,useState} from 'react';
import type {MutationConflict} from '../../types';
import {indexConflictsByDate} from '../../lib/mutationConflicts';
import {longDate} from '../../lib/format';
import {Button} from '../ui/Button';
import {Modal} from '../ui/Modal';

const changeLabels={profile:'Profile change',settings:'Nutrition settings change',entry:'Food diary change',food:'Saved food change',weight:'Weigh-in change',weight_move:'Weigh-in move',day:'Day status change'};

export function ConflictReviewDialog({conflicts,onResolve,onClose}:{conflicts:readonly MutationConflict[];onResolve:(ids:string[])=>Promise<void>;onClose:()=>void}){
  const [confirmingId,setConfirmingId]=useState<string>();
  const [confirmingAll,setConfirmingAll]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const groups=useMemo(()=>indexConflictsByDate(conflicts),[conflicts]);

  const resolve=async(ids:string[])=>{
    setSaving(true);setError('');
    try{
      await onResolve(ids);
      setConfirmingId(undefined);setConfirmingAll(false);
    }catch{
      setError('Could not update saved changes. The unsent edits are still on this device.');
    }finally{setSaving(false);}
  };

  return <Modal open onClose={onClose} title="Review sync conflicts"
    description="These changes were not applied to saved data. They stay on this device until you choose how to resolve them." width="lg" preventDismiss={saving}>
    {conflicts.length===0
      ?<div className="conflict-review-empty"><p>All changes have been reviewed. Your saved diary remains unchanged.</p><div className="conflict-review-actions"><Button variant="primary" onClick={onClose}>Done</Button></div></div>
      :<div className="conflict-review-content">
        {error&&<p className="notice" role="alert">{error}</p>}
        {groups.map(([date,items])=><section className="conflict-review-group" key={date} aria-label={date==='undated'?'Other changes':longDate(date)}>
          <h3>{date==='undated'?'Other changes':longDate(date)}</h3>
          <ul className="conflict-review-list">
            {items.map(conflict=><li className="conflict-review-item" key={conflict.id}>
              <div><h4>{changeLabels[conflict.mutation.kind]}</h4><p>This change was not saved. Keeping the saved version removes the unsent edit from this device.</p>
                {confirmingId===conflict.id&&<p className="conflict-review-confirm-copy">The saved record will stay unchanged.</p>}
              </div>
              <div className="conflict-review-actions">
                {confirmingId===conflict.id
                  ?<><Button variant="tertiary" disabled={saving} onClick={()=>setConfirmingId(undefined)}>Cancel</Button>
                    <Button variant="destructive" disabled={saving} onClick={()=>void resolve([conflict.id])}>Keep saved version</Button></>
                  :<Button variant="secondary" disabled={saving} onClick={()=>{setConfirmingAll(false);setConfirmingId(conflict.id);}}>Resolve this change</Button>}
              </div>
            </li>)}
          </ul>
        </section>)}
        {conflicts.length>1&&<div className="conflict-review-bulk">
          {confirmingAll
            ?<><p role="alert">This removes all {conflicts.length} unsent edits from this device and keeps the saved data.</p>
              <div className="conflict-review-actions"><Button variant="tertiary" disabled={saving} onClick={()=>setConfirmingAll(false)}>Cancel</Button>
                <Button variant="destructive" disabled={saving} onClick={()=>void resolve(conflicts.map(conflict=>conflict.id))}>Keep saved version for all</Button></div></>
            :<Button variant="destructive" disabled={saving} onClick={()=>{setConfirmingId(undefined);setConfirmingAll(true);}}>Resolve all {conflicts.length} changes</Button>}
        </div>}
      </div>}
  </Modal>;
}

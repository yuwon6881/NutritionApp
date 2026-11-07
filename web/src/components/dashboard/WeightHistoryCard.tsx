import {useState} from 'react';
import type {NutritionStore} from '../../useNutritionStore';
import type {Weight} from '../../types';
import {readoutDate} from '../../lib/format';
import {displayWeight,unitsFor,weightLabel} from '../../lib/units';
import {UNDO_WINDOW_MS} from '../../lib/heldMutations';
import {showUndo} from '../ui/UndoToast';
import {WeighInHistory} from '../WeighInHistory';
import {WeightEntryDialog} from '../WeightEntryDialog';
import {WeightDeleteDialog} from '../WeightDeleteDialog';
import type {WeightProgress} from './useWeightProgress';

/** The weigh-ins behind the weight chart, newest first, at the foot of the Dashboard. */
export function WeightHistoryCard({store,progress}:{store:NutritionStore;progress:WeightProgress}){
  const {summary}=progress;
  const units=unitsFor(store.state!.settings);
  const [edit,setEdit]=useState<Weight>();
  const [remove,setRemove]=useState<{weight:Weight;trigger:HTMLElement}>();
  const [restore,setRestore]=useState<HTMLElement|null>(null);
  // Queued deletions disappear at once so Undo reads true.
  const pendingDeletes=new Set((store.local?.queue??[]).filter(op=>op.kind==='weight'&&op.delete).map(op=>op.recordId));
  const deleteWeight=async(weight:Weight)=>{
    const id=await store.mutate({kind:'weight',recordId:weight.id,expectedRevision:weight.revision,data:weight,delete:true},{holdMs:UNDO_WINDOW_MS});
    showUndo(`Deleted weigh-in · ${displayWeight(weight.kg,units.weight,1)} ${weightLabel(units.weight)} · ${readoutDate(weight.date)}`,()=>store.undo([id]));
  };
  if(!summary)return null;
  return <section className="panel dashboard-wide-card weight-history-card">
    <WeighInHistory summary={summary} units={units} onEdit={(weight,trigger)=>{setEdit(weight);setRestore(trigger);}} onDelete={(weight,trigger)=>setRemove({weight,trigger})} pendingDeletes={pendingDeletes}/>
    <WeightEntryDialog open={Boolean(edit)} store={store} date={edit?.date??summary.end} initial={edit} restoreFocus={restore} onClose={()=>setEdit(undefined)}/>
    {remove&&<WeightDeleteDialog weight={remove.weight} unit={units.weight} restoreFocus={remove.trigger} onClose={()=>setRemove(undefined)} onDelete={deleteWeight}/>}
  </section>;
}

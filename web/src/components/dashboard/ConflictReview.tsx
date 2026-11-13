import {lazy,Suspense,useState} from 'react';
import type {MutationConflict} from '../../types';
import type {NutritionStore} from '../../useNutritionStore';
import {Button} from '../ui/Button';

// The review list loads only when opened, so the Dashboard's first load carries just the count.
const ConflictReviewDialog=lazy(()=>import('./ConflictReviewDialog').then(module=>({default:module.ConflictReviewDialog})));
const noConflicts:MutationConflict[]=[];

export function ConflictReview({store}:{store:NutritionStore}){
  const conflicts=store.local?.conflicts??noConflicts;
  const [open,setOpen]=useState(false);
  return <>
    {conflicts.length>0&&<section className="panel dashboard-conflict-review" aria-labelledby="dashboard-conflict-title">
      <div><h2 id="dashboard-conflict-title">Changes to review</h2><p>{conflicts.length} change{conflicts.length===1?'':'s'} could not be saved. They remain on this device.</p></div>
      <Button variant="secondary" onClick={()=>setOpen(true)}>{`Review ${conflicts.length} ${conflicts.length===1?'change':'changes'}`}</Button>
    </section>}
    {open&&<Suspense fallback={null}><ConflictReviewDialog conflicts={conflicts} onResolve={ids=>store.resolveConflicts(ids)} onClose={()=>setOpen(false)}/></Suspense>}
  </>;
}

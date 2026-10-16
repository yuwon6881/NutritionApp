import {lazy,Suspense,useState} from 'react';
import {Footprints} from 'lucide-react';
import type {NutritionStore} from '../useNutritionStore';
import {number} from '../lib/format';
import {getTodayStepCount,type GoogleHealthSyncState} from '../lib/googleHealth';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {SkeletonBlock,SkeletonRegion} from './ui/Skeleton';

const loadDetails=()=>import('./DashboardStepsDetails');
const DashboardStepsDetails=lazy(loadDetails);

/**
 * Today's Google Health steps as a chip in the Today heading row. The connection and totals arrive
 * after the rest of the Dashboard, so the figure sits in a row whose height is already reserved:
 * nothing below it moves when it appears. The freshness, warnings, and calculator open from it.
 */
export function DashboardSteps({store,health,todayDate,onOpenSettings}:{
  store:NutritionStore;
  health:Pick<GoogleHealthSyncState,'status'|'freshness'|'lastSyncedAt'|'days'|'warningMessage'>;
  todayDate:string;
  onOpenSettings?:()=>void;
}){
  const [open,setOpen]=useState(false);
  const [trigger,setTrigger]=useState<HTMLElement|null>(null);
  const count=getTodayStepCount(health.days,todayDate);
  const needsAttention=Boolean(health.warningMessage)||health.freshness==='stale';
  const figure=count===null?'—':number(count);
  return <>
    <Button variant="secondary" size="sm" className="steps-chip" data-attention={needsAttention||undefined}
      aria-label={`Google Health steps today: ${count===null?'none recorded yet':figure}${needsAttention?', needs attention':''}. Open details`}
      onPointerEnter={()=>void loadDetails()} onFocus={()=>void loadDetails()} onClick={event=>{setTrigger(event.currentTarget);setOpen(true);}}>
      <Footprints size={16} aria-hidden="true"/>
      <span className="tabular-num">{figure}</span>
      <span className="steps-chip-unit">steps</span>
      {needsAttention&&<span className="steps-chip-dot" aria-hidden="true"/>}
    </Button>
    <Modal open={open} onClose={()=>setOpen(false)} title="Steps today" width="sm" restoreFocus={trigger}>
      <Suspense fallback={<SkeletonRegion label="Loading steps…"><SkeletonBlock width="40%" height={14}/><SkeletonBlock width="55%" height={30}/><SkeletonBlock height={12}/></SkeletonRegion>}>
        {open&&<DashboardStepsDetails store={store} health={health} todayDate={todayDate} onOpenSettings={onOpenSettings&&(()=>{setOpen(false);onOpenSettings();})}/>}
      </Suspense>
    </Modal>
  </>;
}

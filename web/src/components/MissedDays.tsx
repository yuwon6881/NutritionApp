import {useEffect,useMemo,useState} from 'react';
import type {NutritionStore} from '../useNutritionStore';
import {automaticMissingDays,missingDays} from '../lib/loggingDay';
import type {AppState,Day,Mutation} from '../types';
import {Button} from './ui/Button';
import {Checkbox} from './ui/Checkbox';
import {Modal} from './ui/Modal';
import {longDate,today} from '../lib/format';
import {useAsyncAction} from './ui/useAsyncAction';

/** One day decision per date, written against that date's stored record when it has one. */
function dayDecisions(state:AppState,dates:readonly string[],status:Day['status']):Omit<Mutation,'id'|'holdUntil'>[]{
  const records=new Map<string,Day>();
  for(const day of state.days)if(!records.has(day.date))records.set(day.date,day);
  return dates.map(date=>{
    const day=records.get(date);
    return {kind:'day',recordId:day?.id??crypto.randomUUID(),expectedRevision:day?.revision??0,data:{date,status},delete:false};
  });
}

export function MissedDays({store}:{store:NutritionStore}){
  const [remember,setRemember]=useState(false);
  const {busy,run,pending:busyPending}=useAsyncAction();
  const [error,setError]=useState('');
  const state=store.state!;
  const current=today(state.profile?.timeZone);
  // Mounted at the app root: recompute only when the state, the date, or the default changes.
  const dates=useMemo(()=>missingDays(state,current),[state,current]);
  const date=dates[0];
  const missingDayAction=state.settings?.missingDayAction??'ask';
  const automaticDates=useMemo(()=>automaticMissingDays(state,current,missingDayAction),[state,current,missingDayAction]);

  // Automatically apply default action when configured to fasting or not logging
  useEffect(()=>{
    if(missingDayAction==='ask'||automaticDates.length===0||busyPending)return;
    void run(async()=>{await store.mutateMany(dayDecisions(store.state!,automaticDates,missingDayAction));});
  },[missingDayAction,automaticDates,busy,run,store]);

  // Reset toggle when date changes
  useEffect(()=>{
    setRemember(false);
  },[date]);

  if(missingDayAction!=='ask')return null;

  const save=async(status:'fasting'|'not_logged')=>{
    setError('');
    try{
      await run(async()=>{
        const latest=store.state!;
        if(remember){
          const settings=latest.settings??{checkInWeekday:1,revision:0};
          await store.mutateMany([{
            kind:'settings',
            recordId:latest.id,
            expectedRevision:settings.revision,
            data:{
              checkInWeekday:settings.checkInWeekday,
              weightUnit:settings.weightUnit,
              energyUnit:settings.energyUnit,
              heightUnit:settings.heightUnit,
              missingDayAction:status
            },
            delete:false
          },...dayDecisions(latest,dates,status)]);
        }else{
          await store.mutateMany(dayDecisions(latest,[date],status));
        }
      });
    }catch(ex){setError((ex as Error).message);}
  };
  return <Modal open={!!date} onClose={()=>{}} title={`No food logged for ${date?longDate(date):''}`} description={dates.length>1?`${dates.length} days to review.`:'Fasting or not logging?'} width="sm" hideCloseButton preventDismiss>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="missed-days-actions">
      <div className="missed-days-buttons">
        <Button disabled={busyPending} onClick={()=>void save('fasting')}>Fasting</Button>
        <Button variant="primary" disabled={busyPending} onClick={()=>void save('not_logged')}>Not logging</Button>
      </div>
      <div className="missed-days-toggle-bottom">
        <Checkbox id="missed-days-remember" role="switch" checked={remember} onChange={setRemember} disabled={busyPending}>
          Remember my choice
        </Checkbox>
      </div>
    </div>
  </Modal>;
}

import {useEffect,useState} from 'react';
import type {Nourish} from '../useNourish';
import {automaticMissingDays,missingDays} from '../lib/loggingDay';
import {Button} from './ui/Button';
import {Checkbox} from './ui/Checkbox';
import {Modal} from './ui/Modal';
import {useAsyncAction} from './ui/useAsyncAction';

export function MissedDays({store}:{store:Nourish}){
  const [remember,setRemember]=useState(false);
  const {busy,run}=useAsyncAction();
  const [error,setError]=useState('');
  const dates=missingDays(store.state!);
  const date=dates[0];
  const missingDayAction=store.state?.settings?.missingDayAction??'ask';
  const automaticDates=automaticMissingDays(store.state!,undefined,missingDayAction);
  const hasConflict=store.local?.queue.some(operation=>Boolean(operation.error))??false;

  // Automatically apply default action when configured to fasting or not logging
  useEffect(()=>{
    if(hasConflict||missingDayAction==='ask'||automaticDates.length===0||busy)return;
    void run(async()=>{
      for(const d of automaticDates){
        const day=store.state!.days.find(item=>item.date===d);
        await store.mutate({
          kind:'day',
          recordId:day?.id??crypto.randomUUID(),
          expectedRevision:day?.revision??0,
          data:{date:d,status:missingDayAction},
          delete:false
        });
      }
    });
  },[hasConflict,missingDayAction,automaticDates,busy,run,store]);

  // Reset toggle when date changes
  useEffect(()=>{
    setRemember(false);
  },[date]);

  // Conflict review owns the next user decision. Do not open another blocking
  // modal that could enqueue a second edit for the same protected record.
  if(hasConflict||missingDayAction!=='ask')return null;

  const save=async(status:'fasting'|'not_logged')=>{
    setError('');
    try{
      await run(async()=>{
        if(remember){
          const settings=store.state!.settings??{checkInWeekday:1,revision:0};
          await store.mutate({
            kind:'settings',
            recordId:store.state!.id,
            expectedRevision:settings.revision,
            data:{
              checkInWeekday:settings.checkInWeekday,
              weightUnit:settings.weightUnit,
              energyUnit:settings.energyUnit,
              heightUnit:settings.heightUnit,
              missingDayAction:status
            },
            delete:false
          });
          for(const d of dates){
            const day=store.state!.days.find(item=>item.date===d);
            await store.mutate({
              kind:'day',
              recordId:day?.id??crypto.randomUUID(),
              expectedRevision:day?.revision??0,
              data:{date:d,status},
              delete:false
            });
          }
        }else{
          const day=store.state!.days.find(item=>item.date===date);
          await store.mutate({
            kind:'day',
            recordId:day?.id??crypto.randomUUID(),
            expectedRevision:day?.revision??0,
            data:{date,status},
            delete:false
          });
        }
      });
    }catch(ex){setError((ex as Error).message);}
  };
  return <Modal open={!!date} onClose={()=>{}} title={`No food logged for ${date??''}`} description={dates.length>1?`${dates.length} days to review.`:'Fasting or not logging?'} width="sm" hideCloseButton preventDismiss>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="missed-days-actions">
      <div className="missed-days-buttons">
        <Button disabled={busy} onClick={()=>void save('fasting')}>Fasting</Button>
        <Button variant="primary" disabled={busy} onClick={()=>void save('not_logged')}>Not logging</Button>
      </div>
      <div className="missed-days-toggle-bottom">
        <Checkbox id="missed-days-remember" role="switch" checked={remember} onChange={setRemember} disabled={busy}>
          Remember my choice
        </Checkbox>
      </div>
    </div>
  </Modal>;
}

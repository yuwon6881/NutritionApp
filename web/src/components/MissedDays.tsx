import {useEffect,useRef,useState} from 'react';
import type {Nourish} from '../useNourish';
import {missingDays} from '../lib/loggingDay';
import {Button} from './ui/Button';

export function MissedDays({store}:{store:Nourish}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [dismissed,setDismissed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const dates=missingDays(store.state!);
  const date=dates[0];
  useEffect(()=>{
    if(date&&!dismissed&&!dialog.current?.open)dialog.current?.showModal();
    else if(!date||dismissed)dialog.current?.close();
  },[date,dismissed]);
  const save=async(status:'fasting'|'not_logged')=>{
    setBusy(true);setError('');
    try{
      const day=store.state!.days.find(d=>d.date===date);
      await store.mutate({kind:'day',recordId:day?.id??crypto.randomUUID(),expectedRevision:day?.revision??0,data:{date,status},delete:false});
    }catch(ex){setError((ex as Error).message);}finally{setBusy(false);}
  };
  return <dialog ref={dialog} className="review-dialog" aria-labelledby="missed-day-title" onCancel={()=>setDismissed(true)}>
    <h2 id="missed-day-title">No food logged for {date}</h2>
    <p>{dates.length>1?`${dates.length} days to review. `:''}Were you fasting or not logging?</p>
    <p>Not logging keeps your weigh-ins and coaching estimate. Missing calories stay unknown.</p>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="actions">
      <Button variant="tertiary" disabled={busy} onClick={()=>setDismissed(true)}>Later</Button>
      <Button disabled={busy} onClick={()=>void save('fasting')}>Fasting</Button>
      <Button variant="primary" disabled={busy} onClick={()=>void save('not_logged')}>Not logging</Button>
    </div>
  </dialog>;
}

import {useEffect,useState} from 'react';
import type {Nourish} from '../useNourish';
import {missingDays} from '../lib/loggingDay';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {useAsyncAction} from './ui/useAsyncAction';

export function MissedDays({store}:{store:Nourish}){
  const [dismissed,setDismissed]=useState(false);
  const {busy,run}=useAsyncAction();
  const [error,setError]=useState('');
  const dates=missingDays(store.state!);
  const date=dates[0];
  // Each date is its own question, so recording or skipping one must not hide the rest.
  useEffect(()=>{setDismissed(false);},[date]);
  const save=async(status:'fasting'|'not_logged')=>{
    setError('');
    try{
      await run(async()=>{
        const day=store.state!.days.find(item=>item.date===date);
        await store.mutate({kind:'day',recordId:day?.id??crypto.randomUUID(),expectedRevision:day?.revision??0,data:{date,status},delete:false});
      });
    }catch(ex){setError((ex as Error).message);}
  };
  return <Modal open={!!date&&!dismissed} onClose={()=>setDismissed(true)} title={`No food logged for ${date??''}`} description={dates.length>1?`${dates.length} days to review.`:'Fasting or not logging?'} width="sm">
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="modal-actions"><Button variant="tertiary" disabled={busy} onClick={()=>setDismissed(true)}>Later</Button><Button disabled={busy} onClick={()=>void save('fasting')}>Fasting</Button><Button variant="primary" disabled={busy} onClick={()=>void save('not_logged')}>Not logging</Button></div>
  </Modal>;
}

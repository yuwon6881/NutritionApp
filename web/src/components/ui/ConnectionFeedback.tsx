import {useState} from 'react';
import {CardFeedback} from './CardFeedback';

/** Retry the queued work and the read that failed; an empty outbox alone cannot reconnect. */
export function ConnectionFeedback({message,drain,refresh}:{message:string;drain:()=>Promise<void>;refresh:()=>Promise<void>}){
  const [busy,setBusy]=useState(false);
  const [retryError,setRetryError]=useState('');
  const retry=async()=>{
    if(busy)return;
    setBusy(true);
    setRetryError('');
    try{await drain();await refresh();}
    catch(error){setRetryError(error instanceof Error?error.message:'The service is still unavailable. Try again shortly.');}
    finally{setBusy(false);}
  };
  if(!message&&!retryError)return null;
  return <CardFeedback tone="warning" title="Connection needs attention" message={retryError||message}
    action={{label:busy?'Reconnecting…':'Retry connection',onClick:()=>void retry(),disabled:busy}}/>;
}

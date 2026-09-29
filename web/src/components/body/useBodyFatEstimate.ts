import {useCallback,useState} from 'react';
import {api} from '../../lib/api';
import {hapticTick} from '../../lib/haptics';
import {requestSignature,type BodyFatEstimate,type BodyFatEstimateRequest} from '../../lib/bodyFatEstimate';
import {useAsyncAction} from '../ui/useAsyncAction';

/**
 * A transient AI suggestion for the Body dialog. It is never queued or saved; the dialog's own
 * Save remains the only way a body-fat value is stored.
 */
export function useBodyFatEstimate(){
  const [result,setResult]=useState<{estimate:BodyFatEstimate;signature:string}|null>(null);
  const [error,setError]=useState('');
  const {busy,pending,run,reset}=useAsyncAction();

  const estimate=useCallback(async(request:BodyFatEstimateRequest)=>{
    setError('');
    try{
      const estimate=await run(()=>api<BodyFatEstimate>('/body-records/body-fat-estimate',request,'POST'));
      setResult({estimate,signature:requestSignature(request)});
      hapticTick('success');
    }catch(ex){
      hapticTick('warning');
      setError((ex as Error).message||'The estimate could not be completed. Try again.');
    }
  },[run]);

  const clear=useCallback(()=>{setResult(null);setError('');reset();},[reset]);
  return {result,error,busy,pending,estimate,clear};
}

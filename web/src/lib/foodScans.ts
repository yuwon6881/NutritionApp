import {ApiError, api} from './api';

export type FoodScanMode='photo'|'label'|'description';
export type FoodScanStatus='captured'|'submitted'|'review'|'failed';

export interface FoodScanDraft {
  version:1;
  id:string;
  date:string;
  mode:FoodScanMode;
  description:string;
  imageBase64:string|null;
  status:FoodScanStatus;
  resultJson?:string|null;
  error?:string|null;
  pendingBarcode?:{code:string;purpose:'log'|'recipe'};
  updatedAt?:number;
}

export interface FoodScanJob {
  id:string;
  status:string;
  resultJson?:string|null;
  error?:string|null;
}

export type ScanApi=<T>(path:string,body?:unknown,method?:'GET'|'POST'|'DELETE')=>Promise<T>;

function scanInput(draft:FoodScanDraft){
  return {id:draft.id,mode:draft.mode,description:draft.description,imageBase64:draft.imageBase64};
}

export async function getOrCreateFoodScanJob(draft:FoodScanDraft,request:ScanApi=api):Promise<FoodScanJob>{
  try{
    return await request<FoodScanJob>(`/scans/${encodeURIComponent(draft.id)}`);
  }catch(error){
    if(!(error instanceof ApiError)||error.status!==404)throw error;
  }
  return request<FoodScanJob>('/scans',scanInput(draft),'POST');
}

export async function resumeFoodScanJob(
  draft:FoodScanDraft,
  request:ScanApi=api,
  wait:(milliseconds:number)=>Promise<void>=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds))
):Promise<FoodScanJob>{
  let job=await getOrCreateFoodScanJob(draft,request);
  if(job.status==='uploading'||(job.status==='failed'&&job.error==='Upload interrupted. Try again.'))
    job=await request<FoodScanJob>('/scans',scanInput(draft),'POST');
  if(job.status==='queued'||job.status==='processing')
    job=await request<FoodScanJob>(`/scans/${encodeURIComponent(draft.id)}/process`,{},'POST');

  for(let attempt=0;attempt<60&&(job.status==='uploading'||job.status==='processing');attempt++){
    await wait(1000);
    job=await request<FoodScanJob>(`/scans/${encodeURIComponent(draft.id)}`);
  }
  return job;
}

export function createFoodScanDraft(input:Omit<FoodScanDraft,'version'|'id'|'status'>,id:string=crypto.randomUUID()):FoodScanDraft{
  return {version:1,id,status:'captured',...input};
}

export type FoodScanDraftInput=Pick<FoodScanDraft,'date'|'mode'|'description'|'imageBase64'|'pendingBarcode'>;

export function foodScanDraftForAttempt(
  current:FoodScanDraft|null,
  input:FoodScanDraftInput,
  createId:()=>string=()=>crypto.randomUUID()
):FoodScanDraft{
  const sameInput=current?.date===input.date&&current.mode===input.mode&&current.description===input.description&&
    current.imageBase64===input.imageBase64&&JSON.stringify(current.pendingBarcode??null)===JSON.stringify(input.pendingBarcode??null);
  const confirmedAiFailure=current?.status==='failed'&&current.error!=='Upload interrupted. Try again.';
  if(sameInput&&!confirmedAiFailure)return current!;
  if(current?.status==='captured'&&current.date===input.date)return {...current,...input};
  return createFoodScanDraft(input,createId());
}

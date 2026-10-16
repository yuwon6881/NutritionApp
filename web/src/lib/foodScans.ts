import {ApiError, api} from './api';
import type {AiEstimate} from '../types';
import {parseAiEstimate} from './logFood';

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
  /** When the photo/description was first captured, before any upload attempt. Logged
   * meal time is derived from this, not from whenever a delayed AI review completes. */
  capturedAt?:number;
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

export function createFoodScanDraft(input:Omit<FoodScanDraft,'version'|'id'|'status'|'capturedAt'>,id:string=crypto.randomUUID()):FoodScanDraft{
  return {version:1,id,status:'captured',capturedAt:Date.now(),...input};
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

export interface FoodScanEstimateResult {
  estimate: AiEstimate;
  requestDraft: FoodScanDraft;
}

export async function requestFoodScanEstimate({
  ready,
  currentDraft,
  date,
  mode,
  description,
  photo,
  pendingBarcode,
  persist,
  resumeJob=resumeFoodScanJob,
}:{
  ready:boolean;
  currentDraft:FoodScanDraft|null;
  date:string;
  mode:FoodScanMode;
  description:string;
  photo:string|null;
  pendingBarcode?:{code:string;purpose:'log'|'recipe'};
  persist:(draft:FoodScanDraft)=>Promise<void>;
  resumeJob?:(draft:FoodScanDraft)=>Promise<FoodScanJob>;
}):Promise<FoodScanEstimateResult>{
  if(!ready)throw new Error('Checking saved scan work on this device. Try again in a moment.');
  if(mode!=='description'&&!photo)throw new Error('Choose a photo before continuing.');
  const input={date,mode,description,imageBase64:mode==='description'?null:photo,pendingBarcode:pendingBarcode?{...pendingBarcode}:undefined};
  const base=foodScanDraftForAttempt(currentDraft,input);
  const useSavedReview=base.status==='review'&&!!base.resultJson;
  const requestDraft:FoodScanDraft=useSavedReview?base:{...base,...input,status:'submitted',error:null};
  await persist(requestDraft);
  let job:FoodScanJob;
  try{
    if(useSavedReview)job={id:requestDraft.id,status:'complete',resultJson:requestDraft.resultJson};
    else job=await resumeJob(requestDraft);
  }catch(ex){
    const message=ex instanceof Error?ex.message:'AI could not estimate this meal. Try again.';
    await persist({...requestDraft,status:'submitted',error:message}).catch(()=>undefined);
    throw ex;
  }
  if(job.status!=='complete'||!job.resultJson){
    const message=job.error??'AI could not estimate this meal. Try again.';
    await persist({...requestDraft,status:job.status==='failed'?'failed':'submitted',error:message});
    throw new Error(message);
  }
  const estimate=parseAiEstimate(job.resultJson);
  const barcodeContext=pendingBarcode;
  if(!Array.isArray(estimate.foods)||estimate.foods.length===0){
    if(barcodeContext&&mode==='label')throw new Error('The nutrition label must identify exactly one product. Retake the label photo and try again.');
    throw new Error(estimate.explanation||'AI could not identify a food. Add more detail and try again.');
  }
  await persist({...requestDraft,status:'review',imageBase64:null,resultJson:job.resultJson,error:null});
  return {estimate,requestDraft};
}

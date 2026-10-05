import type {BodyDraft,BodyDraftStep,LocalData} from '../types';
import {api} from './api';

type Commit=(change:(data:LocalData)=>LocalData)=>Promise<void>;
function nextStep(draft:BodyDraft,index:number,revision:number):BodyDraftStep|undefined{
  if(index===0)return {path:`/body-records/${draft.id}`,input:{
    id:draft.mutationId,expectedRevision:draft.expectedRevision,action:draft.action??'save',
    ...((draft.action??'save')==='save'?{data:{date:draft.date,measurements:draft.measurements,
      photos:draft.photos.map(photo=>({id:photo.id,angle:photo.angle})),weightContext:draft.weightContext,
      omitScale:draft.omitScale??false,omitTrend:draft.omitTrend??false}}:{})
  }};
  if(draft.photos.length&&index===1)return {path:`/body-records/${draft.id}/photos`,input:{
    id:draft.id,date:draft.date,photos:draft.photos,mutationId:draft.photoMutationId??crypto.randomUUID(),expectedRevision:revision
  }};
  const photoId=draft.deletePhotoIds?.[index-1-(draft.photos.length?1:0)];
  return photoId?{path:`/body-records/${draft.id}`,input:{
    id:draft.deleteMutationIds?.[photoId]??crypto.randomUUID(),expectedRevision:revision,action:'photo-delete',photoId
  }}:undefined;
}

/** Each exact request is durable before dispatch; completed phases are never sent again. */
export async function dispatchBodyDraft(draft:BodyDraft,commit:Commit,isAlive:()=>boolean):Promise<void>{
  const update=(change:(item:BodyDraft)=>BodyDraft)=>commit(current=>({...current,
    bodyDrafts:(current.bodyDrafts??[]).map(item=>item.mutationId===draft.mutationId?change(item):item)
  }));
  const steps=[...(draft.steps??[])];
  if(!steps.length&&draft.serverRevision!=null){
    // Legacy clients persisted only the root save revision. The remaining requests must be reviewed
    // if they may already have run: reconstructing their former revision changes the request hash.
    if(draft.photoMutationId||Object.keys(draft.deleteMutationIds??{}).length){
      throw new Error('This older partial upload needs review. Your draft is retained; review the saved record before retrying its remaining changes.');
    }
    steps.push({...nextStep(draft,0,draft.expectedRevision)!,revision:draft.serverRevision});
  }
  let revision=draft.serverRevision??draft.expectedRevision;
  for(let index=0;isAlive();index++){
    let step:BodyDraftStep|undefined=steps[index];
    if(!step){
      step=nextStep(draft,index,revision);
      if(!step)break;
      steps.push(step);
      await update(item=>({...item,steps:[...steps]}));
    }
    if(step.revision==null){
      const result=await api<{revision:number}>(step.path,step.input);
      step={...step,revision:result.revision};steps[index]=step;
      await update(item=>({...item,steps:[...steps],serverRevision:result.revision,retryAt:undefined}));
    }
    revision=step.revision!;
  }
  if(!isAlive())return;
  await commit(current=>({...current,bodyDrafts:(current.bodyDrafts??[])
    .filter(item=>item.mutationId!==draft.mutationId)
    .map(item=>item.id===draft.id&&!item.steps?.length?{...item,expectedRevision:revision}:item)}));
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('nutrition:body-saved',{detail:{id:draft.id,revision}}));
}

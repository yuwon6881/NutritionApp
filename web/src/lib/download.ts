import {ApiError} from './api';

export async function downloadApi(path:string,filename:string):Promise<void>{
  const response=await fetch('/api'+path,{
    credentials:'same-origin',
    cache:'no-store',
    headers:{'X-Nutrition-Request':'1'},
    signal:AbortSignal.timeout(120000),
  });
  if(!response.ok){
    let message='The export could not be generated.';
    try{message=(await response.json()).message??message;}catch{/* Keep the safe fallback for gateway errors. */}
    throw new ApiError(message,response.status);
  }
  const blob=await response.blob();
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  link.rel='noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),0);
}

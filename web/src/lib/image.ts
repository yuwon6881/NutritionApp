import {measurePerformance} from './performance';
import {jpegWithinLimit,imageDimensions} from './imageEncoding';

let preparation=Promise.resolve();

export function prepareImage(file:File,maxBytes=1_500_000):Promise<string> {
  // Phone photos can decode to tens of megabytes. Keep only one active encoder.
  const task=preparation.then(()=>prepare(file,maxBytes));
  preparation=task.then(()=>{},()=>{});
  return task;
}

async function prepare(file:File,maxBytes:number):Promise<string> {
  if(file.size>20_000_000)throw new Error('Choose a photo smaller than 20 MB.');
  const finish=measurePerformance('photo.prepare');
  try {
    const blob=await encodeInWorker(file,maxBytes).catch(()=>encodeOnPage(file,maxBytes));
    return await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=()=>reject(new Error('This photo could not be read. Try another photo.'));
      reader.readAsDataURL(blob);
    });
  } catch(error) {
    if(error instanceof Error&&error.message.includes('fit'))throw error;
    throw new Error('This photo format cannot be decoded here. Choose JPEG/PNG or take a new photo.');
  } finally { finish(); }
}

function encodeInWorker(file:File,maxBytes:number):Promise<Blob> {
  if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof createImageBitmap==='undefined')
    return Promise.reject(new Error('Worker image encoding is unavailable.'));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./image.worker.ts',import.meta.url),{type:'module'});
    const settle=(blob?:Blob,error?:string)=>{
      clearTimeout(timeout);worker.terminate();
      if(blob)resolve(blob);else reject(new Error(error??'Image worker unavailable.'));
    };
    const timeout=setTimeout(()=>settle(undefined,'Image preparation timed out.'),30000);
    worker.onmessage=(event:MessageEvent<{blob?:Blob;error?:string}>)=>settle(event.data.blob,event.data.error);
    worker.onerror=()=>settle();
    try { worker.postMessage({file,maxBytes}); }
    catch { settle(); }
  });
}

async function encodeOnPage(file:File,maxBytes:number):Promise<Blob> {
  const url=URL.createObjectURL(file);
  const image=new Image();
  const canvas=document.createElement('canvas');
  try {
    image.src=url;await image.decode();
    const dimensions=imageDimensions(image.naturalWidth,image.naturalHeight);
    canvas.width=dimensions.width;canvas.height=dimensions.height;
    const context=canvas.getContext('2d');
    if(!context)throw new Error('Image canvas unavailable.');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return await jpegWithinLimit(quality=>new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality)),maxBytes);
  } finally {
    image.src='';canvas.width=0;canvas.height=0;URL.revokeObjectURL(url);
  }
}

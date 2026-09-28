import {imageDimensions,jpegWithinLimit} from './imageEncoding';

const scope=self as unknown as {
  onmessage:((event:MessageEvent<{file:File;maxBytes:number}>)=>void)|null;
  postMessage:(result:{blob?:Blob;error?:string})=>void;
};
scope.onmessage=event=>{
  void (async()=>{
    let bitmap:ImageBitmap|undefined;
    let canvas:OffscreenCanvas|undefined;
    try {
      bitmap=await createImageBitmap(event.data.file,{imageOrientation:'from-image'});
      const size=imageDimensions(bitmap.width,bitmap.height);
      canvas=new OffscreenCanvas(size.width,size.height);
      const context=canvas.getContext('2d');
      if(!context)throw new Error('Image canvas unavailable.');
      context.drawImage(bitmap,0,0,size.width,size.height);
      const surface=canvas;
      const blob=await jpegWithinLimit(quality=>surface.convertToBlob({type:'image/jpeg',quality}),event.data.maxBytes);
      scope.postMessage({blob});
    } catch(error) {
      scope.postMessage({error:error instanceof Error?error.message:'Image preparation failed.'});
    } finally { bitmap?.close();if(canvas){canvas.width=0;canvas.height=0;} }
  })();
};

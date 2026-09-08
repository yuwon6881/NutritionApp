export async function prepareImage(file:File,maxBytes=1_500_000):Promise<string>{
  if(file.size>20_000_000)throw new Error('Choose a photo smaller than 20 MB.');
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();img.src=url;await img.decode();
    const canvas=document.createElement('canvas');const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
    canvas.getContext('2d')!.drawImage(img,0,0,canvas.width,canvas.height);
    // Canvas re-encoding strips EXIF/location metadata and produces a common provider format.
    for(const quality of [.82,.65,.45]){const encoded=canvas.toDataURL('image/jpeg',quality).split(',')[1];if(encoded.length<=Math.floor(maxBytes/3)*4)return encoded;}
    throw new Error('Photo is too detailed to fit. Crop it and try again.');
  }catch(ex){if(ex instanceof Error&&ex.message.includes('fit'))throw ex;throw new Error('This photo format cannot be decoded here. Choose JPEG/PNG or take a new photo.');}
  finally{URL.revokeObjectURL(url);}
}

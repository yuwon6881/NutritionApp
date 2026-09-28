export function imageDimensions(width:number,height:number) {
  const scale=Math.min(1,1600/Math.max(width,height));
  return {width:Math.round(width*scale),height:Math.round(height*scale)};
}

export async function jpegWithinLimit(encode:(quality:number)=>Promise<Blob|null>,maxBytes:number):Promise<Blob> {
  // Re-encoding strips EXIF/location data and keeps the existing provider format and quality ladder.
  for(const quality of [.82,.65,.45]) {
    const blob=await encode(quality);
    if(blob&&blob.size<=Math.floor(maxBytes/3)*3)return blob;
  }
  throw new Error('Photo is too detailed to fit. Crop it and try again.');
}

/**
 * Decodes retail barcodes from camera frames. Uses the browser's built-in
 * BarcodeDetector where it supports the retail formats (fast, off the main
 * JavaScript path) and falls back to the bundled zxing reader elsewhere.
 */
export type FrameDecoder=(canvas:HTMLCanvasElement)=>Promise<string|null>;

const RETAIL_FORMATS=['ean_13','ean_8','upc_a','upc_e'];

interface DetectedBarcode {rawValue:string}
interface BarcodeDetectorInstance {detect(source:CanvasImageSource):Promise<DetectedBarcode[]>}
interface BarcodeDetectorConstructor {
  new(options:{formats:string[]}):BarcodeDetectorInstance;
  getSupportedFormats():Promise<string[]>;
}

/** Scanning errors that only mean "no complete code in this frame yet". */
export function isPositioningMiss(error:unknown){
  const exception=error as Error&{getKind?:()=>string};
  const name=exception?.getKind?.()??exception?.name;
  return ['NotFoundException','ChecksumException','FormatException'].includes(name);
}

async function nativeDetector():Promise<FrameDecoder|null>{
  const Detector=(globalThis as {BarcodeDetector?:BarcodeDetectorConstructor}).BarcodeDetector;
  if(!Detector)return null;
  try{
    const supported=await Detector.getSupportedFormats();
    const formats=RETAIL_FORMATS.filter(format=>supported.includes(format));
    if(!formats.includes('ean_13'))return null;
    const detector=new Detector({formats});
    return async canvas=>(await detector.detect(canvas))[0]?.rawValue??null;
  }catch{
    return null;
  }
}

export async function createFrameDecoder():Promise<FrameDecoder>{
  const native=await nativeDetector();
  if(native)return native;
  const {BrowserMultiFormatReader}=await import('@zxing/browser');
  const reader=new BrowserMultiFormatReader();
  return async canvas=>{
    try{return reader.decodeFromCanvas(canvas).getText();}
    catch(error){
      if(isPositioningMiss(error))return null;
      throw error;
    }
  };
}

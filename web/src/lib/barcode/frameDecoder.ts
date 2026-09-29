/**
 * Decodes product codes from camera frames. Uses the browser's built-in
 * BarcodeDetector where it supports the retail formats (fast, off the main
 * JavaScript path) and falls back to the bundled zxing reader elsewhere.
 * Only retail barcodes and QR codes are read; a decoded code is returned only
 * when it carries a valid product number.
 */
import {productCodeFromScan,type ScannedFormat} from './productCode';

export type FrameDecoder=(canvas:HTMLCanvasElement)=>Promise<string|null>;

const PRODUCT_FORMATS=['ean_13','ean_8','upc_a','upc_e','qr_code'];

interface DetectedBarcode {rawValue:string;format?:string}
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

function scannedFormat(format:string|undefined):ScannedFormat{
  return PRODUCT_FORMATS.includes(format??'')?format as ScannedFormat:'unknown';
}

/** The first detection in a frame that identifies a product. */
export function firstProductCode(detections:DetectedBarcode[]):string|null{
  for(const detection of detections){
    const code=productCodeFromScan(detection.rawValue,scannedFormat(detection.format));
    if(code)return code;
  }
  return null;
}

async function nativeDetector():Promise<FrameDecoder|null>{
  const Detector=(globalThis as {BarcodeDetector?:BarcodeDetectorConstructor}).BarcodeDetector;
  if(!Detector)return null;
  try{
    const supported=await Detector.getSupportedFormats();
    const formats=PRODUCT_FORMATS.filter(format=>supported.includes(format));
    if(!formats.includes('ean_13'))return null;
    const detector=new Detector({formats});
    return async canvas=>firstProductCode(await detector.detect(canvas));
  }catch{
    return null;
  }
}

async function zxingDecoder():Promise<FrameDecoder>{
  const {BrowserMultiFormatReader,BarcodeFormat}=await import('@zxing/browser');
  const zxingFormats=new Map<number,ScannedFormat>([
    [BarcodeFormat.EAN_13,'ean_13'],[BarcodeFormat.EAN_8,'ean_8'],[BarcodeFormat.UPC_A,'upc_a'],
    [BarcodeFormat.UPC_E,'upc_e'],[BarcodeFormat.QR_CODE,'qr_code'],
  ]);
  // Other symbologies still decode here; productCodeFromScan rejects them.
  const reader=new BrowserMultiFormatReader();
  return async canvas=>{
    try{
      const result=reader.decodeFromCanvas(canvas);
      return productCodeFromScan(result.getText(),zxingFormats.get(result.getBarcodeFormat())??'unknown');
    }catch(error){
      if(isPositioningMiss(error))return null;
      throw error;
    }
  };
}

export async function createFrameDecoder():Promise<FrameDecoder>{
  return await nativeDetector()??await zxingDecoder();
}

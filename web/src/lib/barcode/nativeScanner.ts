import {Capacitor,type PluginListenerHandle} from '@capacitor/core';
import {productCodeFromScan,type ScannedFormat} from './productCode';

/**
 * The Android app scans with the bundled ML Kit barcode model. The camera
 * preview is drawn behind the web view so the app keeps its own viewfinder,
 * torch control, and Back behaviour. Anything unavailable falls back to the
 * in-page camera.
 */
export type NativeScanStart=
  |{kind:'started';session:NativeScanSession}
  |{kind:'denied'}
  |{kind:'unavailable'};

export interface NativeScanSession {
  torchAvailable:boolean;
  setTorch(on:boolean):Promise<void>;
  stop():Promise<void>;
}

/** Root class that makes the web view transparent over the camera preview. */
export const NATIVE_SCAN_CLASS='native-barcode-scan-active';

const FORMATS:Record<string,ScannedFormat>={EAN_13:'ean_13',EAN_8:'ean_8',UPC_A:'upc_a',UPC_E:'upc_e',QR_CODE:'qr_code'};

let availability:Promise<boolean>|null=null;

async function loadPlugin(){
  return import('@capacitor-mlkit/barcode-scanning');
}

export function nativeBarcodeScannerAvailable():Promise<boolean>{
  if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android')return Promise.resolve(false);
  availability??=(async()=>{
    try{return (await (await loadPlugin()).BarcodeScanner.isSupported()).supported;}
    catch{return false;}
  })();
  return availability;
}

/** Product code from one ML Kit detection batch, ignoring codes that are not product numbers. */
export function productCodeFromDetections(barcodes:{rawValue?:string;format?:string}[]):string|null{
  for(const barcode of barcodes){
    const code=barcode.rawValue?productCodeFromScan(barcode.rawValue,FORMATS[barcode.format??'']??'unknown'):null;
    if(code)return code;
  }
  return null;
}

export async function startNativeScan({onCode,onError}:{
  onCode:(code:string)=>void;
  onError:(message:string)=>void;
}):Promise<NativeScanStart>{
  if(!(await nativeBarcodeScannerAvailable()))return {kind:'unavailable'};
  const {BarcodeScanner,BarcodeFormat,LensFacing}=await loadPlugin();
  try{
    let permission=(await BarcodeScanner.checkPermissions()).camera;
    if(permission!=='granted'&&permission!=='limited')permission=(await BarcodeScanner.requestPermissions()).camera;
    if(permission!=='granted'&&permission!=='limited')return {kind:'denied'};
  }catch{
    return {kind:'unavailable'};
  }

  const listeners:PluginListenerHandle[]=[];
  let stopped=false;
  const stop=async()=>{
    if(stopped)return;
    stopped=true;
    document.documentElement.classList.remove(NATIVE_SCAN_CLASS);
    await Promise.allSettled(listeners.map(listener=>listener.remove()));
    await BarcodeScanner.stopScan().catch(()=>undefined);
  };
  try{
    listeners.push(await BarcodeScanner.addListener('barcodesScanned',event=>{
      if(stopped)return;
      const code=productCodeFromDetections(event.barcodes);
      if(code)void stop().then(()=>onCode(code));
    }));
    listeners.push(await BarcodeScanner.addListener('scanError',()=>{
      if(!stopped)void stop().then(()=>onError('Camera scanning failed. Try again or enter the barcode digits.'));
    }));
    document.documentElement.classList.add(NATIVE_SCAN_CLASS);
    await BarcodeScanner.startScan({
      formats:[BarcodeFormat.Ean13,BarcodeFormat.Ean8,BarcodeFormat.UpcA,BarcodeFormat.UpcE,BarcodeFormat.QrCode],
      lensFacing:LensFacing.Back,
    });
    const torchAvailable=await BarcodeScanner.isTorchAvailable().then(result=>result.available,()=>false);
    return {kind:'started',session:{
      torchAvailable,
      setTorch:on=>on?BarcodeScanner.enableTorch():BarcodeScanner.disableTorch(),
      stop,
    }};
  }catch{
    await stop();
    return {kind:'unavailable'};
  }
}

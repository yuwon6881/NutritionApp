import type {PluginListenerHandle} from '@capacitor/core';
import {selectTargetedProduct,type ScanGeometry,type ScanRect} from './nativeTargeting';
import {loadBarcodePlugin,nativeBarcodeScannerAvailable} from './nativeScannerAvailability';

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


export async function startNativeScan({onCode,onError,getFrame,onSuspend}:{
  onCode:(code:string)=>void;
  onError:(message:string)=>void;
  getFrame:()=>ScanRect|null;
  onSuspend?:()=>void;
}):Promise<NativeScanStart>{
  if(!(await nativeBarcodeScannerAvailable()))return {kind:'unavailable'};
  const {BarcodeScanner,BarcodeFormat,LensFacing}=await loadBarcodePlugin();
  const adapter=BarcodeScanner as typeof BarcodeScanner&{getScanCoordinateContract:()=>Promise<{version:number}>};
  try { if((await adapter.getScanCoordinateContract()).version!==1)return {kind:'unavailable'}; }
  catch { return {kind:'unavailable'}; }
  try{
    let permission=(await BarcodeScanner.checkPermissions()).camera;
    if(permission!=='granted'&&permission!=='limited')permission=(await BarcodeScanner.requestPermissions()).camera;
    if(permission!=='granted'&&permission!=='limited')return {kind:'denied'};
  }catch{
    return {kind:'unavailable'};
  }

  const listeners:PluginListenerHandle[]=[];
  let stopped=false;
  let suspended=false;
  let lifecycle:Promise<void>=Promise.resolve();
  const scanOptions={formats:[BarcodeFormat.Ean13,BarcodeFormat.Ean8,BarcodeFormat.UpcA,BarcodeFormat.UpcE,BarcodeFormat.QrCode],lensFacing:LensFacing.Back};
  const pause=async()=>{
    document.documentElement.classList.remove(NATIVE_SCAN_CLASS);
    await BarcodeScanner.disableTorch().catch(()=>undefined);
    await BarcodeScanner.stopScan().catch(()=>undefined);
  };
  const stop=async()=>{
    if(stopped)return;
    stopped=true;
    document.removeEventListener('visibilitychange',visibilityChanged);
    document.documentElement.classList.remove(NATIVE_SCAN_CLASS);
    await Promise.allSettled(listeners.map(listener=>listener.remove()));
    await lifecycle.catch(()=>undefined);
    await pause();
  };
  const changeActive=(active:boolean)=>{
    if(stopped||suspended===!active)return;
    suspended=!active;
    if(!active)onSuspend?.();
    lifecycle=lifecycle.then(async()=>{
      if(stopped)return;
      if(!active){await pause();return;}
      if(suspended)return;
      const permission=(await BarcodeScanner.checkPermissions()).camera;
      if(permission!=='granted'&&permission!=='limited')throw new Error('Camera permission was withdrawn. Enter the barcode digits or allow camera access.');
      document.documentElement.classList.add(NATIVE_SCAN_CLASS);
      await BarcodeScanner.startScan(scanOptions);
    }).catch(()=>{void stop().then(()=>onError('Camera scanning stopped. Try again or enter the barcode digits.'));});
  };
  const visibilityChanged=()=>changeActive(document.visibilityState==='visible');
  try{
    listeners.push(await BarcodeScanner.addListener('barcodesScanned',event=>{
      if(stopped||suspended)return;
      const frame=getFrame();
      const geometry=(event as unknown as {geometry?:ScanGeometry}).geometry;
      if(!frame||!geometry)return;
      const code=selectTargetedProduct(event.barcodes,geometry,{width:window.innerWidth,height:window.innerHeight},frame);
      if(code)void stop().then(()=>onCode(code));
    }));
    listeners.push(await BarcodeScanner.addListener('scanError',()=>{
      if(!stopped)void stop().then(()=>onError('Camera scanning failed. Try again or enter the barcode digits.'));
    }));
    document.documentElement.classList.add(NATIVE_SCAN_CLASS);
    await BarcodeScanner.startScan(scanOptions);
    const {App}=await import('@capacitor/app');
    listeners.push(await App.addListener('appStateChange',({isActive})=>changeActive(isActive)));
    document.addEventListener('visibilitychange',visibilityChanged);
    if(document.visibilityState!=='visible')changeActive(false);
    const torchAvailable=await BarcodeScanner.isTorchAvailable().then(result=>result.available,()=>false);
    return {kind:'started',session:{
      torchAvailable,
      setTorch:on=>on&&!stopped&&!suspended?BarcodeScanner.enableTorch():BarcodeScanner.disableTorch(),
      stop,
    }};
  }catch{
    await stop();
    return {kind:'unavailable'};
  }
}

import {Capacitor} from '@capacitor/core';

/**
 * The Android app scans with Google's ML Kit code scanner: faster, better in
 * low light, and no camera permission because Play services owns the camera.
 * Anything unavailable falls back to the in-page camera.
 */
export type NativeScanResult={kind:'code';code:string}|{kind:'cancelled'}|{kind:'unavailable'};

let availability:Promise<boolean>|null=null;

async function loadScanner(){
  return (await import('@capacitor-mlkit/barcode-scanning')).BarcodeScanner;
}

export function nativeBarcodeScannerAvailable():Promise<boolean>{
  if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android')return Promise.resolve(false);
  availability??=(async()=>{
    try{
      const scanner=await loadScanner();
      if(!(await scanner.isSupported()).supported)return false;
      if((await scanner.isGoogleBarcodeScannerModuleAvailable()).available)return true;
      // Play services downloads the module in the background; use the in-page camera until then.
      void scanner.installGoogleBarcodeScannerModule().then(()=>{availability=null;}).catch(()=>{});
      return false;
    }catch{
      return false;
    }
  })();
  return availability;
}

export async function scanWithNativeScanner():Promise<NativeScanResult>{
  if(!(await nativeBarcodeScannerAvailable()))return {kind:'unavailable'};
  try{
    const {BarcodeFormat}=await import('@capacitor-mlkit/barcode-scanning');
    const scanner=await loadScanner();
    const {barcodes}=await scanner.scan({formats:[BarcodeFormat.Ean13,BarcodeFormat.Ean8,BarcodeFormat.UpcA,BarcodeFormat.UpcE],autoZoom:true});
    const code=barcodes.find(barcode=>barcode.rawValue)?.rawValue;
    return code?{kind:'code',code}:{kind:'cancelled'};
  }catch(error){
    // The Google scanner reports a closed scanner as an error.
    return /cancel/i.test((error as Error)?.message??'')?{kind:'cancelled'}:{kind:'unavailable'};
  }
}

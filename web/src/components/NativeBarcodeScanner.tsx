import {useEffect,useRef,useState} from 'react';
import {Flashlight,FlashlightOff,X} from 'lucide-react';
import {startNativeScan,type NativeScanSession} from '../lib/barcode/nativeScanner';
import {hapticTick} from '../lib/haptics';
import {useBackLayer} from '../lib/useBackLayer';
import {BarcodeViewfinder} from './BarcodeViewfinder';
import {Button} from './ui/Button';

/**
 * Full-screen Android scanner. ML Kit draws the camera behind the transparent
 * web view; this top-layer dialog supplies the viewfinder and controls.
 * `onUnavailable` hands over to the in-page camera.
 */
export function NativeBarcodeScanner({onDetected,onClose,onUnavailable,onError}:{
  onDetected:(code:string)=>void;
  onClose:()=>void;
  onUnavailable:()=>void;
  onError:(message:string)=>void;
}){
  const dialog=useRef<HTMLDialogElement>(null);
  const session=useRef<NativeScanSession|null>(null);
  const callbacks=useRef({onDetected,onClose,onUnavailable,onError});
  callbacks.current={onDetected,onClose,onUnavailable,onError};
  const [ready,setReady]=useState(false);
  const [torchAvailable,setTorchAvailable]=useState(false);
  const [torchOn,setTorchOn]=useState(false);
  useBackLayer(true,()=>callbacks.current.onClose());

  useEffect(()=>{
    const element=dialog.current;
    if(element&&!element.open)element.showModal();
    let unmounted=false;
    void startNativeScan({
      onCode:code=>{
        if(unmounted)return;
        hapticTick();
        callbacks.current.onDetected(code);
      },
      onError:message=>{if(!unmounted)callbacks.current.onError(message);},
    }).then(result=>{
      if(result.kind!=='started'){
        if(unmounted)return;
        if(result.kind==='denied')callbacks.current.onError('Allow camera access to scan, or enter the barcode digits.');
        else callbacks.current.onUnavailable();
        return;
      }
      // The scanner may finish starting after this surface has already closed.
      if(unmounted){void result.session.stop();return;}
      session.current=result.session;
      setTorchAvailable(result.session.torchAvailable);
      setReady(true);
    });
    return()=>{
      unmounted=true;
      void session.current?.stop();
      session.current=null;
      if(element?.open)element.close();
    };
  },[]);

  const toggleTorch=()=>{
    const next=!torchOn;
    void session.current?.setTorch(next).then(()=>setTorchOn(next),()=>setTorchAvailable(false));
  };

  return <dialog
    ref={dialog}
    className="native-barcode-scanner"
    aria-label="Scan barcode"
    onCancel={event=>{event.preventDefault();callbacks.current.onClose();}}
  >
    <div className="native-barcode-top">
      <Button variant="secondary" size="icon" aria-label="Stop barcode camera" onClick={()=>callbacks.current.onClose()}><X size={20} aria-hidden="true"/></Button>
    </div>
    <BarcodeViewfinder/>
    <div className="native-barcode-bottom">
      <p role="status">{ready?'Line up the barcode or QR code inside the frame.':'Starting camera…'}</p>
      {torchAvailable&&<Button variant="secondary" aria-pressed={torchOn} onClick={toggleTorch}>
        {torchOn?<FlashlightOff size={18} aria-hidden="true"/>:<Flashlight size={18} aria-hidden="true"/>}
        {torchOn?'Torch off':'Torch on'}
      </Button>}
    </div>
  </dialog>;
}

import {useEffect,useRef,useState} from 'react';
import {Flashlight,FlashlightOff} from 'lucide-react';
import {barcodeCrop} from '../lib/barcode';
import {createFrameDecoder} from '../lib/barcode/frameDecoder';
import {hapticTick} from '../lib/haptics';
import {Button} from './ui/Button';

// Torch is a Chromium camera capability not yet in the DOM typings.
type TorchTrack=Omit<MediaStreamTrack,"getCapabilities">&{getCapabilities?:()=>MediaTrackCapabilities&{torch?:boolean}};

export function BarcodeCamera({onDetected,onError}:{onDetected:(code:string)=>void;onError:(message:string)=>void}){
  const video=useRef<HTMLVideoElement>(null);
  const frame=useRef<HTMLDivElement>(null);
  const track=useRef<TorchTrack|null>(null);
  const callbacks=useRef({onDetected,onError});
  callbacks.current={onDetected,onError};
  const [ready,setReady]=useState(false);
  const [torchAvailable,setTorchAvailable]=useState(false);
  const [torchOn,setTorchOn]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    let stream:MediaStream|undefined;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const preview=video.current!;
    const stop=()=>{cancelled=true;clearTimeout(timer);stream?.getTracks().forEach(item=>item.stop());track.current=null;preview.srcObject=null;};
    const fail=(message:string)=>{stop();callbacks.current.onError(message);};
    const start=async()=>{
      try{
        const decode=await createFrameDecoder();
        if(cancelled)return;
        stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
        if(cancelled){stream.getTracks().forEach(item=>item.stop());return;}
        preview.srcObject=stream;
        await preview.play();
        if(cancelled)return;
        const videoTrack=stream.getVideoTracks()[0] as TorchTrack|undefined;
        track.current=videoTrack??null;
        setTorchAvailable(Boolean(videoTrack?.getCapabilities?.().torch));
        setReady(true);
        const canvas=document.createElement('canvas');
        const context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('Camera processing unavailable');
        const scan=async()=>{
          if(cancelled)return;
          if(preview.readyState>=2&&frame.current){
            const crop=barcodeCrop(preview.videoWidth,preview.videoHeight,preview.getBoundingClientRect(),frame.current.getBoundingClientRect());
            if(crop){
              const scale=Math.min(1,960/crop.width);
              canvas.width=Math.max(1,Math.round(crop.width*scale));canvas.height=Math.max(1,Math.round(crop.height*scale));
              context.drawImage(preview,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
              let code:string|null;
              try{code=await decode(canvas);}
              catch{fail('Camera scanning failed. Try again or enter the barcode digits.');return;}
              if(code&&!cancelled){
                stop();
                hapticTick();
                callbacks.current.onDetected(code);
                return;
              }
            }
          }
          timer=setTimeout(()=>void scan(),180);
        };
        void scan();
      }catch(error){
        if(cancelled)return;
        fail((error as Error).name==='NotAllowedError'
          ?'Allow camera access to scan, or enter the barcode digits.'
          :'Camera unavailable. Enter the barcode digits instead.');
      }
    };
    void start();return stop;
  },[]);
  const toggleTorch=()=>{
    const next=!torchOn;
    void track.current?.applyConstraints({advanced:[{torch:next} as MediaTrackConstraintSet]})
      .then(()=>setTorchOn(next))
      .catch(()=>setTorchAvailable(false));
  };
  return <div className="barcode-camera">
    <div className="barcode-viewport">
      <video ref={video} className="barcode-video" muted playsInline autoPlay aria-label="Barcode camera preview"/>
      <div ref={frame} className="barcode-frame" aria-hidden="true"><i/><i/><i/><i/></div>
    </div>
    <div className="barcode-camera-status">
      <p role="status">{ready?'Place the barcode inside the frame.':'Starting camera…'}</p>
      {torchAvailable&&<Button type="button" variant="secondary" size="sm" aria-pressed={torchOn} onClick={toggleTorch}>
        {torchOn?<FlashlightOff size={16} aria-hidden="true"/>:<Flashlight size={16} aria-hidden="true"/>}
        {torchOn?'Torch off':'Torch on'}
      </Button>}
    </div>
  </div>;
}

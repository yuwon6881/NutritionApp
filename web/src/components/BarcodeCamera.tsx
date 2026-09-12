import {useEffect,useRef,useState} from 'react';
import {barcodeCrop} from '../lib/barcode';

export function BarcodeCamera({onDetected,onError,continuous=false}:{onDetected:(code:string)=>void;onError:(message:string)=>void;continuous?:boolean}){
  const video=useRef<HTMLVideoElement>(null);
  const frame=useRef<HTMLDivElement>(null);
  const callbacks=useRef({onDetected,onError,continuous});
  callbacks.current={onDetected,onError,continuous};
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    let stream:MediaStream|undefined;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const cooldowns=new Map<string,number>();
    const preview=video.current!;
    const stop=()=>{cancelled=true;clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());preview.srcObject=null;};
    const start=async()=>{
      try{
        const {BrowserMultiFormatReader}=await import('@zxing/browser');
        if(cancelled)return;
        stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
        if(cancelled){stream.getTracks().forEach(track=>track.stop());return;}
        preview.srcObject=stream;
        await preview.play();
        if(cancelled)return;
        setReady(true);
        const reader=new BrowserMultiFormatReader();
        const canvas=document.createElement('canvas');
        const context=canvas.getContext('2d',{willReadFrequently:true});
        if(!context)throw new Error('Camera processing unavailable');
        const scan=()=>{
          if(cancelled)return;
          if(preview.readyState>=2&&frame.current){
            const crop=barcodeCrop(preview.videoWidth,preview.videoHeight,preview.getBoundingClientRect(),frame.current.getBoundingClientRect());
            if(crop){
              const scale=Math.min(1,960/crop.width);
              canvas.width=Math.max(1,Math.round(crop.width*scale));canvas.height=Math.max(1,Math.round(crop.height*scale));
              context.drawImage(preview,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
              try{
                const result=reader.decodeFromCanvas(canvas);
                if(result&&!cancelled){
                  const code=result.getText();
                  if(!callbacks.current.continuous){
                    stop();
                    callbacks.current.onDetected(code);
                    return;
                  }
                  const now=Date.now();
                  const lastSeen=cooldowns.get(code)??0;
                  if(now-lastSeen>1200){
                    cooldowns.set(code,now);
                    callbacks.current.onDetected(code);
                  }
                }
              }catch(error){
                // No code, incomplete data, and checksum misses are normal while positioning.
                const exception=error as Error&{getKind?:()=>string};
                const name=exception.getKind?.()??exception.name;
                if(!['NotFoundException','ChecksumException','FormatException'].includes(name)){
                  stop();callbacks.current.onError('Camera scanning failed. Try again or enter the barcode digits.');return;
                }
              }
            }
          }
          timer=setTimeout(scan,180);
        };
        scan();
      }catch(error){
        if(cancelled)return;
        stop();
        callbacks.current.onError((error as Error).name==='NotAllowedError'
          ?'Allow camera access to scan, or enter the barcode digits.'
          :'Camera unavailable. Enter the barcode digits instead.');
      }
    };
    void start();return stop;
  },[]);
  return <div className="barcode-camera">
    <div className="barcode-viewport">
      <video ref={video} className="barcode-video" muted playsInline autoPlay aria-label="Barcode camera preview"/>
      <div ref={frame} className="barcode-frame" aria-hidden="true"><i/><i/><i/><i/></div>
    </div>
    <p role="status">{ready?'Place the barcode inside the frame.':'Starting camera…'}</p>
  </div>;
}

import {useRef,useCallback} from 'react';

export interface LongPressOptions {
  onLongPress:()=>void;
  thresholdMs?:number;
  moveTolerancePx?:number;
  disabled?:boolean;
}

export function useLongPress({
  onLongPress,
  thresholdMs=400,
  moveTolerancePx=8,
  disabled=false,
}:LongPressOptions){
  const timerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const startPosRef=useRef<{x:number;y:number}|null>(null);
  const triggeredRef=useRef(false);

  const clear=useCallback(()=>{
    if(timerRef.current){
      clearTimeout(timerRef.current);
      timerRef.current=null;
    }
    startPosRef.current=null;
  },[]);

  const onPointerDown=useCallback((e:React.PointerEvent)=>{
    if(disabled||e.pointerType!=='touch')return;
    const target=e.target as HTMLElement;
    if(target.closest('button,a,input,select,textarea,summary'))return;

    clear();
    triggeredRef.current=false;
    startPosRef.current={x:e.clientX,y:e.clientY};

    timerRef.current=setTimeout(()=>{
      triggeredRef.current=true;
      if(typeof navigator!=='undefined'&&'vibrate' in navigator){
        try{navigator.vibrate(35);}catch{}
      }
      onLongPress();
      clear();
    },thresholdMs);
  },[disabled,thresholdMs,onLongPress,clear]);

  const onPointerMove=useCallback((e:React.PointerEvent)=>{
    if(!startPosRef.current||!timerRef.current)return;
    const dx=e.clientX-startPosRef.current.x;
    const dy=e.clientY-startPosRef.current.y;
    if(Math.hypot(dx,dy)>moveTolerancePx){
      clear();
    }
  },[moveTolerancePx,clear]);

  const onPointerUp=useCallback(()=>{
    clear();
  },[clear]);

  const onPointerCancel=useCallback(()=>{
    clear();
  },[clear]);

  const onClickCapture=useCallback((e:React.MouseEvent)=>{
    if(triggeredRef.current){
      e.preventDefault();
      e.stopPropagation();
      triggeredRef.current=false;
    }
  },[]);

  return {
    handlers:{
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
    hasTriggered:()=>triggeredRef.current,
  };
}

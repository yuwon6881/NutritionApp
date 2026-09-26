import {useEffect,useState} from 'react';
import {Undo2} from 'lucide-react';
import {UNDO_WINDOW_MS} from '../../lib/heldMutations';
import {Button} from './Button';

/**
 * One undo notice at a time, announced politely and placed above the bottom
 * navigation. It closes when its window ends; a newer notice replaces an
 * older one, whose deletion then simply completes.
 */
interface UndoNotice {
  id:number;
  message:string;
  expiresAt:number;
  onUndo:()=>Promise<boolean>|boolean;
}

let current:UndoNotice|null=null;
let nextId=1;
const listeners=new Set<(notice:UndoNotice|null)=>void>();
const publish=(notice:UndoNotice|null)=>{current=notice;listeners.forEach(listener=>listener(notice));};

export function showUndo(message:string,onUndo:()=>Promise<boolean>|boolean,durationMs=UNDO_WINDOW_MS){
  publish({id:nextId++,message,expiresAt:Date.now()+durationMs,onUndo});
}

export function UndoToastHost(){
  const [notice,setNotice]=useState<UndoNotice|null>(current);
  const [result,setResult]=useState('');
  useEffect(()=>{
    listeners.add(setNotice);
    return()=>{listeners.delete(setNotice);};
  },[]);
  useEffect(()=>{
    if(!notice)return;
    setResult('');
    const timer=window.setTimeout(()=>{if(current?.id===notice.id)publish(null);},Math.max(0,notice.expiresAt-Date.now()));
    return()=>window.clearTimeout(timer);
  },[notice]);
  useEffect(()=>{
    if(!result)return;
    const timer=window.setTimeout(()=>setResult(''),2500);
    return()=>window.clearTimeout(timer);
  },[result]);

  const undo=async()=>{
    if(!notice)return;
    const restored=await notice.onUndo();
    if(current?.id===notice.id)publish(null);
    setResult(restored?'Restored.':'Too late to undo; the deletion was already sent.');
  };

  if(!notice&&!result)return null;
  return <div className="undo-toast" role="status" aria-live="polite">
    <span>{notice?notice.message:result}</span>
    {notice&&<Button variant="tertiary" size="sm" onClick={()=>void undo()}><Undo2 size={16} aria-hidden="true"/>Undo</Button>}
  </div>;
}

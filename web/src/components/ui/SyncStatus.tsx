import {AlertTriangle,Check,Cloud,CloudOff,LoaderCircle} from 'lucide-react';
import {useEffect,useState} from 'react';
import type {Nourish} from '../../useNourish';

function pendingWork(store:Nourish){
  const queue=store.local?.queue.length??0;
  const scans=store.local?.scans.filter(scan=>!scan.result&&!scan.error).length??0;
  const photos=store.local?.photoDrafts?.filter(draft=>!draft.error).length??0;
  return queue+scans+photos;
}

export function SyncStatus({store}:{store:Nourish}){
  const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine);
  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine);
    window.addEventListener('online',update);window.addEventListener('offline',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);

  const conflicts=store.local?.queue.filter(operation=>operation.error).length??0;
  const pending=pendingWork(store);
  const syncing=store.sync.phase==='syncing';
  const synced=store.sync.phase==='synced'&&pending===0&&!conflicts;
  const attention=conflicts>0;
  if(!syncing&&!synced&&!pending&&!attention)return null;

  let title='Saved on this device';
  let detail=online?'Syncing when ready.':'Will sync when you reconnect.';
  let tone='pending';
  let Icon=online?Cloud:CloudOff;
  if(attention){
    title=`${conflicts} saved edit${conflicts===1?'':'s'} needs review`;
    detail='The server record is protected until you review the queued change.';
    tone='attention';
    Icon=AlertTriangle;
  }else if(syncing){
    title=store.sync.kind==='scan'?'Processing scan…':store.sync.kind==='photo'?'Uploading photo set…':'Syncing changes…';
    detail='Your latest changes are being sent to the server.';
    tone='syncing';
    Icon=LoaderCircle;
  }else if(synced){
    title='All changes saved';
    detail='Your latest changes are on the server.';
    tone='synced';
    Icon=Check;
  }

  return <div className={`sync-status sync-status-${tone}`} role="status" aria-live="polite" aria-atomic="true" aria-busy={syncing||undefined}>
    <span className="sync-status-icon" aria-hidden="true"><Icon size={17}/></span>
    <span className="sync-status-copy"><strong>{title}</strong><small>{detail}</small></span>
  </div>;
}

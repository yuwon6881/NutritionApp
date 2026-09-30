import {CloudOff,LoaderCircle} from 'lucide-react';
import {useEffect,useState} from 'react';
import type {Nourish} from '../../useNourish';

function pendingWork(store:Nourish){
  const queue=store.local?.queue.length??0;
  const photos=store.local?.photoDrafts?.filter(draft=>!draft.error).length??0;
  const body=store.local?.bodyDrafts?.filter(draft=>!draft.error).length??0;
  return queue+photos+body;
}

export function SyncStatus({store}:{store:Nourish}){
  const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine);
  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine);
    window.addEventListener('online',update);window.addEventListener('offline',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);

  const pending=pendingWork(store);
  const meaningfulSync=store.sync.phase==='syncing'&&(store.sync.kind==='photo'||store.sync.kind==='body');
  const retainedOffline=pending>0&&!online;
  if(!meaningfulSync&&!retainedOffline)return null;

  let title='Saved on this device';
  let detail='Will sync when you reconnect.';
  let tone='pending';
  let Icon=CloudOff;
  if(meaningfulSync){
    title=store.sync.kind==='body'?'Saving Body record…':'Uploading photo set…';
    detail='Your latest changes are being sent to the server.';
    tone='syncing';
    Icon=LoaderCircle;
  }

  return <div className={`sync-status sync-status-${tone}`} role="status" aria-live="polite" aria-atomic="true" aria-busy={meaningfulSync||undefined}>
    <span className="sync-status-icon" aria-hidden="true"><Icon size={17}/></span>
    <span className="sync-status-copy"><strong>{title}</strong><small>{detail}</small></span>
  </div>;
}

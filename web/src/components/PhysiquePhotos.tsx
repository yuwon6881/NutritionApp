import {useEffect,useState} from 'react';
import type {Nourish} from '../useNourish';
import {api} from '../lib/api';
import {number} from '../lib/format';
import {Button} from './ui/Button';
import {PhotoUploadDialog} from './PhotoUploadDialog';

type Photo={id:string;date:string;caption:string;angle:string;bytes:number};
type Gallery={configured:boolean;usedBytes:number;maxBytes:number;photos:Photo[]};

export function PhysiquePhotos({store}:{store:Nourish}){
  const [gallery,setGallery]=useState<Gallery>();
  const [uploadOpen,setUploadOpen]=useState(false);
  const [uploadReturnFocus,setUploadReturnFocus]=useState<HTMLElement|null>(null);
  const [error,setError]=useState('');
  const [skip,setSkip]=useState(0);
  const [selected,setSelected]=useState<Photo[]>([]);
  const [deleting,setDeleting]=useState<string>();
  const [busy,setBusy]=useState(false);
  const drafts=store.local!.photoDrafts??[];

  useEffect(()=>{void api<Gallery>('/photos?skip='+skip).then(setGallery).catch(ex=>setError(ex.message));},[skip,drafts.length]);
  const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(ex){setError((ex as Error).message);}finally{setBusy(false);}};

  return <>
    <section className="panel physique">
      <div className="section-heading"><div><h2>Physique progress</h2><p>Compare private progress photos and track retained uploads.</p></div><Button variant="primary" onClick={event=>{setUploadReturnFocus(event.currentTarget);setUploadOpen(true);}}>Add photo</Button></div>
      {gallery&&!gallery.configured&&<p>Photo storage is not configured. A local draft can still be prepared.</p>}
      {drafts.map(draft=><div className="notice" key={draft.id}><p>{draft.date} · {draft.angle} · {draft.error??'Uploading when connected.'}</p><div className="actions">{draft.error&&<Button onClick={()=>void store.retryPhoto(draft.id)}>Retry photo</Button>}<Button onClick={()=>void store.removePhotoDraft(draft.id)}>Discard local photo draft</Button></div></div>)}
      {gallery&&<><p className="source">{number(gallery.usedBytes/1048576,1)} / {number(gallery.maxBytes/1048576)} MiB used</p><h3>Compare</h3>{selected.length>0&&<div className="photo-comparison">{selected.map(photo=><figure key={photo.id}><img src={`/api/photos/${photo.id}/content`} alt={`${photo.angle} physique photo from ${photo.date}`}/><figcaption>{photo.date} · {photo.angle}<Button variant="tertiary" onClick={()=>setSelected(selected.filter(item=>item.id!==photo.id))}>Remove from comparison</Button></figcaption></figure>)}</div>}<div className="photo-gallery">{gallery.photos.map(photo=><figure key={photo.id}><img src={`/api/photos/${photo.id}/content`} alt={`${photo.angle} physique photo from ${photo.date}`} loading="lazy"/><figcaption><strong>{photo.date}</strong><p>{photo.angle} · {photo.caption}</p><div className="actions"><Button disabled={selected.some(item=>item.id===photo.id)} onClick={()=>setSelected([...selected.slice(-1),photo])}>Compare</Button><Button variant="tertiary" onClick={()=>setDeleting(photo.id)}>Delete</Button></div>{deleting===photo.id&&<div className="notice"><p>Delete this photo?</p><Button variant="destructive" disabled={busy} onClick={()=>void action(async()=>{await api(`/photos/${photo.id}/delete`,{});setSelected(selected.filter(item=>item.id!==photo.id));setGallery(await api<Gallery>('/photos?skip='+skip));setDeleting(undefined);})}>Delete photo</Button><Button onClick={()=>setDeleting(undefined)}>Keep photo</Button></div>}</figcaption></figure>)}</div><div className="actions"><Button disabled={skip===0} onClick={()=>setSkip(Math.max(0,skip-24))}>Newer photos</Button><Button disabled={gallery.photos.length<24} onClick={()=>setSkip(skip+24)}>Older photos</Button></div></>}
      {error&&<p className="error" role="alert">{error}</p>}
    </section>
    <PhotoUploadDialog open={uploadOpen} store={store} restoreFocus={uploadReturnFocus} onClose={()=>setUploadOpen(false)}/>
  </>;
}

import {useEffect,useMemo,useState} from 'react';
import type {Nourish} from '../useNourish';
import type {PhysiqueAngle,PhysiquePhoto,PhysiquePhotoSet} from '../types';
import {api} from '../lib/api';
import {number} from '../lib/format';
import {Button} from './ui/Button';
import {PhotoUploadDialog} from './PhotoUploadDialog';
import {useAsyncAction} from './ui/useAsyncAction';

const angles:PhysiqueAngle[]=['front','side','back'];
const angleLabel=(angle:PhysiqueAngle)=>angle[0].toUpperCase()+angle.slice(1);

type Gallery={configured:boolean;usedBytes:number;maxBytes:number;photos:PhysiquePhoto[]};

export function PhysiquePhotos({store}:{store:Nourish}){
  const [gallery,setGallery]=useState<Gallery>();
  const [uploadOpen,setUploadOpen]=useState(false);
  const [uploadReturnFocus,setUploadReturnFocus]=useState<HTMLElement|null>(null);
  const [editingSet,setEditingSet]=useState<PhysiquePhotoSet>();
  const [error,setError]=useState('');
  const [skip,setSkip]=useState(0);
  const [selected,setSelected]=useState<PhysiquePhoto[]>([]);
  const [deleting,setDeleting]=useState<string>();
  const {busy,run}=useAsyncAction();
  const {run:runLoad}=useAsyncAction();
  const drafts=store.local!.photoDrafts??[];

  const loadGallery=async()=>{
    setError('');
    const end=store.beginActivity('photos');
    try{
      const next=await runLoad(()=>api<Gallery>('/photos?skip='+skip));
      setGallery(next);
    }catch(ex){setError((ex as Error).message);}
    finally{end();}
  };
  useEffect(()=>{void loadGallery();},[skip,drafts.length]);

  const sets=useMemo<PhysiquePhotoSet[]>(()=>{
    const byId=new Map<string,PhysiquePhotoSet>();
    for(const photo of gallery?.photos??[]){
      const setId=photo.setId||photo.id;
      const set=byId.get(setId)??{id:setId,date:photo.date,photos:[]};
      set.photos.push(photo);set.date=photo.date;byId.set(setId,set);
    }
    return [...byId.values()].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  },[gallery?.photos]);

  const action=async(fn:()=>Promise<void>)=>{setError('');try{await run(fn);}catch(ex){setError((ex as Error).message);}};
  const openNew=(trigger:HTMLElement)=>{setEditingSet(undefined);setUploadReturnFocus(trigger);setUploadOpen(true);};
  const openEdit=(set:PhysiquePhotoSet,trigger:HTMLElement)=>{setEditingSet(set);setUploadReturnFocus(trigger);setUploadOpen(true);};
  const closeUpload=()=>{setUploadOpen(false);setEditingSet(undefined);};
  const removeSelected=(id:string)=>setSelected(current=>current.filter(photo=>photo.id!==id));

  return <>
    <section className="panel physique">
      <div className="section-heading">
        <div><h2>Physique progress</h2><p>Compare private progress sets and track retained uploads.</p></div>
        <div className="actions"><Button variant="primary" onClick={event=>openNew(event.currentTarget)}>Add photo set</Button></div>
      </div>
      {gallery&&!gallery.configured&&<p>Photo storage is not configured. A local draft can still be prepared.</p>}
      {!gallery&&!error&&<div className="skeleton" aria-busy="true" style={{minHeight:240}}/>}
      {drafts.map(draft=><div className="notice" key={draft.id}><p>{draft.date} · {draft.photos.map(photo=>angleLabel(photo.angle)).join(', ')||'No views'} · {draft.error??'Uploading when connected.'}</p><div className="actions">{draft.error&&<Button onClick={()=>void store.retryPhoto(draft.id)}>Retry photo set</Button>}<Button onClick={()=>void store.removePhotoDraft(draft.id)}>Discard local photo set</Button></div></div>)}
      {gallery&&<>
        <p className="source">{number(gallery.usedBytes/1048576,1)} / {number(gallery.maxBytes/1048576)} MiB used</p>
        <h3>Compare</h3>
        {selected.length>0&&<div className="photo-comparison">{selected.map(photo=><figure key={photo.id}><img src={`/api/photos/${photo.id}/content`} alt={`${photo.angle} physique photo from ${photo.date}`}/><figcaption>{photo.date} · {angleLabel(photo.angle)}<Button variant="tertiary" onClick={()=>removeSelected(photo.id)}>Remove from comparison</Button></figcaption></figure>)}</div>}
        <div className="photo-gallery">
          {sets.map(set=><article className="photo-set" key={set.id}>
            <div className="section-heading"><div><h3>{set.date}</h3><p>{set.photos.length} of 3 views</p></div><Button variant="secondary" onClick={event=>openEdit(set,event.currentTarget)}>Edit set</Button></div>
            <div className="photo-set-grid">
              {angles.map(angle=>{
                const photo=set.photos.find(item=>item.angle===angle);
                if(!photo)return <div className="photo-slot-empty" key={angle}><strong>{angleLabel(angle)}</strong><span>Not uploaded</span></div>;
                const isSelected=selected.some(item=>item.id===photo.id);
                return <figure className="photo-set-slot" key={photo.id}>
                  <img src={`/api/photos/${photo.id}/content`} alt={`${angleLabel(angle)} physique photo from ${photo.date}`} loading="lazy"/>
                  <figcaption><strong>{angleLabel(angle)}</strong><div className="actions"><Button disabled={isSelected} onClick={()=>setSelected(current=>isSelected?current:[...current.slice(-1),photo])}>Compare</Button><Button variant="tertiary" onClick={()=>setDeleting(photo.id)}>Delete</Button></div>
                    {deleting===photo.id&&<div className="notice"><p>Delete this {angle} view?</p><Button variant="destructive" disabled={busy} onClick={()=>void action(async()=>{await api(`/photos/${photo.id}/delete`,{});removeSelected(photo.id);await loadGallery();setDeleting(undefined);})}>Delete view</Button><Button onClick={()=>setDeleting(undefined)}>Keep view</Button></div>}
                  </figcaption>
                </figure>;
              })}
            </div>
          </article>)}
        </div>
        <div className="actions"><Button disabled={skip===0} onClick={()=>setSkip(Math.max(0,skip-24))}>Newer photos</Button><Button disabled={gallery.photos.length<24} onClick={()=>setSkip(skip+24)}>Older photos</Button></div>
      </>}
      {error&&<p className="error" role="alert">{error}</p>}
    </section>
    <PhotoUploadDialog open={uploadOpen} store={store} initial={editingSet} restoreFocus={uploadReturnFocus} onClose={closeUpload}/>
  </>;
}

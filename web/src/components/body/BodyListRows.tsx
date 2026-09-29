import {useEffect,useRef,useState} from 'react';
import type {Nourish} from '../../useNourish';
import type {BodyDraft,BodyRecord,PhysiqueDraft,PhysiquePhoto,PhysiquePhotoSet} from '../../types';
import {number} from '../../lib/format';
import {allMeasurementKeys,angleLabel,angles,measurementLabel} from '../../lib/bodyMeasurements';
import {Button} from '../ui/Button';
import {SkeletonBlock} from '../ui/Skeleton';

const measurementCount=(record:BodyRecord)=>allMeasurementKeys.filter(key=>record.measurements[key]!=null).length;

export function BodyHistoryRow({record,onOpen,onEdit}:{record:BodyRecord;onOpen:()=>void;onEdit:(trigger:HTMLElement)=>void}){
  const preview=record.photos.find(photo=>photo.status==='complete');
  const count=measurementCount(record);
  const summary=allMeasurementKeys.filter(key=>record.measurements[key]!=null).slice(0,2).map(key=>measurementLabel(key)+' '+number(record.measurements[key],1)+(key==='bodyFatPercent'?'%':' cm')).join(' · ');
  return <article className="body-history-row">
    <Button presentation="plain" className="body-history-main" onClick={onOpen}>
      <span className="body-history-date">{record.date}</span>
      <span className="body-history-meta">{count} measurement{count===1?'':'s'}{record.photos.length?' · '+record.photos.length+' photo'+(record.photos.length===1?'':'s'):''}</span>
      {summary&&<span className="body-history-meta">{summary}</span>}
      {record.weightContext.provenance!=='legacy-unavailable'&&<span className="body-history-meta">Weight snapshot {record.weightContext.scaleKg==null&&record.weightContext.trendKg==null?'unavailable':'attached'}</span>}
    </Button>
    {preview?<img className="body-history-thumb" src={'/api/photos/'+preview.id+'/content'} alt={'Body record '+record.date}/>:<div className="body-history-thumb body-history-thumb-empty" aria-hidden="true">No photo</div>}
    <Button variant="tertiary" size="md" onClick={event=>onEdit(event.currentTarget)}>Edit</Button>
  </article>;
}

export function BodyDraftNotice({draft,store}:{draft:BodyDraft;store:Nourish}){
  const count=Object.values(draft.measurements).filter(value=>value!=null).length;
  const detail=draft.action==='delete'?'Delete pending':count+' measurement'+(count===1?'':'s')+(draft.photos.length?' · '+draft.photos.length+' photo'+(draft.photos.length===1?'':'s'):'');
  return <div className="notice body-draft-notice"><p>{draft.date} · {detail} · {draft.error??'Saved locally; syncing when connected.'}</p><div className="actions">{draft.error&&<Button onClick={()=>void store.retryBody(draft.id)}>Retry Body record</Button>}<Button variant="tertiary" onClick={()=>void store.removeBodyDraft(draft.id)}>Discard local Body record</Button></div></div>;
}

export function PhotoDraftNotice({draft,store}:{draft:PhysiqueDraft;store:Nourish}){
  return <div className="notice"><p>{draft.date} · {draft.photos.map(photo=>angleLabel(photo.angle)).join(', ')||'No views'} · {draft.error??'Uploading when connected.'}</p><div className="actions">{draft.error&&<Button onClick={()=>void store.retryPhoto(draft.id)}>Retry photo set</Button>}<Button variant="tertiary" onClick={()=>void store.removePhotoDraft(draft.id)}>Discard local photo set</Button></div></div>;
}

export function PhotoSetRow({set,onEdit}:{set:PhysiquePhotoSet;onEdit:(set:PhysiquePhotoSet,trigger:HTMLElement)=>void}){
  return <article className="photo-gallery-row"><div className="photo-gallery-row-heading"><h3>{set.date}</h3><Button variant="tertiary" onClick={event=>onEdit(set,event.currentTarget)}>Edit</Button></div><div className="photo-gallery-previews">{angles.map(angle=>{
    const photo=set.photos.find(item=>item.angle===angle);
    return <figure key={angle}>{photo?<LazyPhoto photo={photo} label={angleLabel(angle)+' view from '+set.date}/>:<div className="photo-slot-empty"><strong>{angleLabel(angle)}</strong><span>Not uploaded</span></div>}{photo&&<figcaption>{angleLabel(angle)}</figcaption>}</figure>;
  })}</div></article>;
}

function LazyPhoto({photo,label}:{photo:PhysiquePhoto;label:string}){
  const ref=useRef<HTMLDivElement>(null);const [near,setNear]=useState(false);
  useEffect(()=>{
    if(!ref.current)return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setNear(true);observer.disconnect();}},{rootMargin:'240px'});
    observer.observe(ref.current);return()=>observer.disconnect();
  },[]);
  return <div ref={ref} className="photo-lazy-frame">{near?<img loading="lazy" decoding="async" src={`/api/photos/${photo.id}/content`} alt={label}/>:<div className="photo-lazy-placeholder" aria-label={`Loading ${label}`}/>}</div>;
}

/** Placeholder rows shaped like history rows or gallery sets so loading does not jump. */
export function BodyListSkeleton({kind,label}:{kind:'history'|'gallery';label:string}){
  return <div className="body-list-skeleton" aria-busy="true">
    <p className="sr-only" role="status">{label}</p>
    {[0,1,2].map(index=>kind==='history'
      ?<div className="body-history-row body-skeleton-row" key={index}><span className="body-skeleton-lines"><SkeletonBlock width="38%" height={16}/><SkeletonBlock width="70%" height={11}/><SkeletonBlock width="55%" height={11}/></span><SkeletonBlock className="body-history-thumb" width={72} height={88} radius={10}/><span/></div>
      :<div className="photo-gallery-row" key={index}><SkeletonBlock width="30%" height={16}/><div className="photo-gallery-previews">{angles.map(angle=><SkeletonBlock key={angle} className="body-skeleton-photo" height={0} radius={10}/>)}</div></div>)}
  </div>;
}

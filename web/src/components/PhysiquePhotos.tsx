import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Camera,Scale,ArrowLeftRight} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {BodyDraft,BodyMeasurementKey,BodyPage,BodyRecord,PhysiqueAngle,PhysiquePhoto,PhysiquePhotoPage,PhysiquePhotoSet} from '../types';
import {api} from '../lib/api';
import {number} from '../lib/format';
import {Button} from './ui/Button';
import {SegmentedControl} from './ui/SegmentedControl';
import {PhotoUploadDialog} from './PhotoUploadDialog';
import {useAsyncAction} from './ui/useAsyncAction';
import {displayWeight,unitsFor,weightLabel} from '../lib/units';
import {CardFeedback} from './ui/CardFeedback';
import {BodyCompare} from './BodyCompare';
import {BodyRecordDialog,allMeasurementKeys,angles,angleLabel,measurementGroups,measurementLabel} from './BodyRecordDialog';

const measurementCount=(record:BodyRecord)=>allMeasurementKeys.filter(key=>record.measurements[key]!=null).length;

export function PhysiquePhotos({store}:{store:Nourish}){
  const [page,setPage]=useState<'home'|'history'|'body-viewer'|'gallery'|'viewer'|'compare'>('home');
  const [bodyRecords,setBodyRecords]=useState<BodyRecord[]>([]);
  const [bodyCursor,setBodyCursor]=useState<string|null>(null);
  const [bodyHasMore,setBodyHasMore]=useState(false);
  const [bodyLoaded,setBodyLoaded]=useState(false);
  const [bodyError,setBodyError]=useState('');
  const [bodyEditor,setBodyEditor]=useState<BodyRecord>();
  const [bodyOpen,setBodyOpen]=useState(false);
  const [bodyReturnFocus,setBodyReturnFocus]=useState<HTMLElement|null>(null);
  const [bodyViewerIndex,setBodyViewerIndex]=useState(0);
  const [bodyViewerAngle,setBodyViewerAngle]=useState<PhysiqueAngle>('front');
  const [sets,setSets]=useState<PhysiquePhotoSet[]>([]);
  const [hasMore,setHasMore]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState('');
  const [editingSet,setEditingSet]=useState<PhysiquePhotoSet>();
  const [uploadOpen,setUploadOpen]=useState(false);
  const [uploadReturnFocus,setUploadReturnFocus]=useState<HTMLElement|null>(null);
  const [viewerIndex,setViewerIndex]=useState(0);
  const [viewerAngle,setViewerAngle]=useState<PhysiqueAngle>('front');
  const galleryScroll=useRef(0);
  const cursorRef=useRef<string|null>(null);
  const loadingRef=useRef(false);
  const {busy,run}=useAsyncAction();

  const loadBodyPage=useCallback(async(reset=false)=>{
    if(reset)setBodyError('');
    try{
      const cursor=reset?null:bodyCursor;
      const response=await run(()=>api<BodyPage>('/body-records'+(cursor?'?cursor='+encodeURIComponent(cursor):'')));
      setBodyCursor(response.nextCursor);setBodyHasMore(response.hasMore);setBodyLoaded(true);
      setBodyRecords(current=>{
        if(reset)return response.records;
        const byId=new Map(current.map(item=>[item.id,item]));response.records.forEach(item=>byId.set(item.id,item));return [...byId.values()];
      });
      return response.records.length;
    }catch(ex){setBodyError((ex as Error).message);return 0;}
  },[bodyCursor,run]);

  const loadPage=useCallback(async(reset=false)=>{
    if(loadingRef.current)return 0;
    loadingRef.current=true;setError('');
    try{
      const cursor=reset?null:cursorRef.current;
      const response=await run(()=>api<PhysiquePhotoPage>('/photos?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):'')));
      cursorRef.current=response.nextCursor;setHasMore(response.hasMore);setLoaded(true);
      setSets(current=>{
        if(reset)return response.sets;
        const byId=new Map(current.map(item=>[item.id,item]));
        response.sets.forEach(item=>byId.set(item.id,item));
        return [...byId.values()];
      });
      return response.sets.length;
    }catch(ex){setError((ex as Error).message);return 0;}
    finally{loadingRef.current=false;}
  },[run]);

  useEffect(()=>{
    if(page==='gallery'&&!loaded)void loadPage(true);
    if((page==='history'||page==='compare')&&!bodyLoaded)void loadBodyPage(true);
    if(page==='gallery'){
      const frame=window.requestAnimationFrame(()=>window.scrollTo({top:galleryScroll.current,behavior:'auto'}));
      return()=>window.cancelAnimationFrame(frame);
    }
  },[page,loaded,loadPage,bodyLoaded,loadBodyPage]);

  const rememberGallery=()=>{galleryScroll.current=window.scrollY;};
  const openGallery=()=>{galleryScroll.current=0;setPage('gallery');};
  const closeGallery=()=>{rememberGallery();setPage('home');};
  const openHistory=()=>{setPage('history');void loadBodyPage(true);};
  const closeHistory=()=>{setPage('home');};
  const openBodyEditor=(record:BodyRecord|undefined,trigger?:HTMLElement|null)=>{setBodyEditor(record);setBodyReturnFocus(trigger??null);setBodyOpen(true);};
  const closeBodyEditor=()=>{setBodyOpen(false);setBodyEditor(undefined);void loadBodyPage(true);};
  const openEdit=(set:PhysiquePhotoSet,trigger:HTMLElement)=>{setEditingSet(set);setUploadReturnFocus(trigger);setUploadOpen(true);};
  const closeUpload=()=>{setUploadOpen(false);setEditingSet(undefined);void loadPage(true);};
  const openViewer=()=>{if(!sets.length)return;rememberGallery();setViewerIndex(0);setViewerAngle('front');setPage('viewer');};
  const goOlder=async()=>{if(viewerIndex+1<sets.length){setViewerIndex(index=>index+1);return;}if(!hasMore)return;const count=await loadPage(false);if(count>0)setViewerIndex(index=>index+1);};
  const goNewer=()=>{if(viewerIndex>0)setViewerIndex(index=>index-1);};
  const openBodyViewer=(index:number)=>{setBodyViewerIndex(index);setBodyViewerAngle('front');setPage('body-viewer');};
  const openCompare=(targetIndex=0)=>{setBodyViewerIndex(targetIndex);setPage('compare');};
  const goBodyOlder=()=>{if(bodyViewerIndex+1<bodyRecords.length)setBodyViewerIndex(index=>index+1);};
  const goBodyNewer=()=>{if(bodyViewerIndex>0)setBodyViewerIndex(index=>index-1);};

  const drafts=store.local?.photoDrafts??[];
  const bodyDrafts=store.local?.bodyDrafts??[];
  const weightUnit=unitsFor(store.state!.settings).weight;

  if(page==='compare'){
    return <>
      <BodyCompare records={bodyRecords} initialPresentIndex={bodyViewerIndex} initialPastIndex={bodyRecords.length>1?bodyRecords.length-1:0} weightUnit={weightUnit} onBack={()=>setPage('history')} onEditRecord={rec=>openBodyEditor(rec)}/>
      <BodyRecordDialog open={bodyOpen} record={bodyEditor} store={store} restoreFocus={bodyReturnFocus} onClose={closeBodyEditor}/>
    </>;
  }

  if(page==='history')return <>
    <header className="page-heading photo-view-heading"><div className="subpage-header-title"><Button variant="tertiary" size="sm" className="subpage-back-button" onClick={closeHistory}><ArrowLeft size={16} aria-hidden="true"/>Back to Body</Button><h2>Body history</h2></div><Button variant="primary" onClick={event=>openBodyEditor(undefined,event.currentTarget)}>Add body record</Button></header>
    {bodyError&&<p className="notice" role="status">{bodyError} <Button onClick={()=>void loadBodyPage(!bodyRecords.length)}>Retry history</Button></p>}
    <section className="panel body-history-panel">
      <div className="section-heading"><div><h2>Measurements and photos</h2><p>Records are ordered by date. Weight attachments are server snapshots.</p></div><Button variant="secondary" disabled={!bodyRecords.length} onClick={()=>openCompare(0)}>Compare</Button></div>
      {!bodyRecords.length&&!bodyError&&<p className="empty">{bodyLoaded?'No Body records yet.':'Loading Body history…'}</p>}
      <div className="body-history-list">{bodyRecords.map((record,index)=><BodyHistoryRow key={record.id} record={record} onOpen={()=>openBodyViewer(index)} onEdit={trigger=>openBodyEditor(record,trigger)}/>)}</div>
      {bodyHasMore&&<div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={()=>void loadBodyPage(false)}>{busy?'Loading…':'Load more'}</Button></div>}
    </section>
    {bodyDrafts.map(draft=><BodyDraftNotice key={draft.id} draft={draft} store={store}/>)}
    <BodyRecordDialog open={bodyOpen} record={bodyEditor} store={store} restoreFocus={bodyReturnFocus} onClose={closeBodyEditor}/>
  </>;

  if(page==='body-viewer'){
    const current=bodyRecords[bodyViewerIndex];
    return <>
      <header className="page-heading photo-view-heading"><div className="subpage-header-title"><Button variant="tertiary" size="sm" className="subpage-back-button" onClick={()=>setPage('history')}><ArrowLeft size={16} aria-hidden="true"/>Back to Body history</Button><h2>Body record</h2></div><div className="physique-hub-actions"><Button variant="secondary" onClick={()=>openCompare(bodyViewerIndex)}><ArrowLeftRight size={16} aria-hidden="true"/>Compare with past</Button><Button variant="secondary" onClick={event=>openBodyEditor(current,event.currentTarget)}>Edit record</Button></div></header>
      {current&&<BodyRecordViewer record={current} previous={bodyRecords[bodyViewerIndex+1]} angle={bodyViewerAngle} onAngle={setBodyViewerAngle} weightUnit={weightUnit}/>}
      <div className="modal-actions body-history-nav"><Button variant="secondary" disabled={bodyViewerIndex===0} onClick={goBodyNewer}>Newer record</Button><Button variant="secondary" disabled={bodyViewerIndex===bodyRecords.length-1} onClick={goBodyOlder}>Older record</Button></div>
      <BodyRecordDialog open={bodyOpen} record={bodyEditor} store={store} restoreFocus={bodyReturnFocus} onClose={closeBodyEditor}/>
    </>;
  }

  if(page==='gallery')return <>
    <header className="page-heading photo-view-heading"><div className="subpage-header-title"><Button variant="tertiary" size="sm" className="subpage-back-button" onClick={closeGallery}><ArrowLeft size={16} aria-hidden="true"/>Back to Body</Button><h2>Gallery</h2></div><Button variant="primary" onClick={event=>{setEditingSet(undefined);setUploadReturnFocus(event.currentTarget);setUploadOpen(true);}}>Add photo set</Button></header>
    {error&&<CardFeedback title="Photo gallery unavailable" message={error} action={{label:'Retry gallery',onClick:()=>void loadPage(!sets.length),disabled:busy}}/>}
    <section className="panel physique-gallery-panel">
      <div className="section-heading"><div><h2>Compare</h2><p>Newest sets appear first. Missing views stay missing.</p></div><Button variant="secondary" disabled={!sets.length} onClick={openViewer}>Compare</Button></div>
      {!sets.length&&!error&&<p className="empty">{loaded?'No photo sets yet.':'Loading gallery…'}</p>}
      <div className="photo-gallery-list">{sets.map(set=><PhotoSetRow key={set.id} set={set} onEdit={openEdit}/>)}</div>
      {hasMore&&<div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={()=>void loadPage(false)}>{busy?'Loading…':'Load more'}</Button></div>}
    </section>
    {drafts.map(draft=><div className="notice" key={draft.id}><p>{draft.date} · {draft.photos.map(photo=>angleLabel(photo.angle)).join(', ')||'No views'} · {draft.error??'Uploading when connected.'}</p><div className="actions">{draft.error&&<Button onClick={()=>void store.retryPhoto(draft.id)}>Retry photo set</Button>}<Button variant="tertiary" onClick={()=>void store.removePhotoDraft(draft.id)}>Discard local photo set</Button></div></div>)}
    <PhotoUploadDialog open={uploadOpen} store={store} initial={editingSet} restoreFocus={uploadReturnFocus} onClose={closeUpload} onChanged={()=>void loadPage(true)}/>
  </>;

  if(page==='viewer'){
    const current=sets[viewerIndex];
    const photo=current?.photos.find(item=>item.angle===viewerAngle);
    const adjacent=viewerIndex>0?sets[viewerIndex-1]:sets[viewerIndex+1];
    return <>
      <header className="page-heading photo-view-heading"><div className="subpage-header-title"><Button variant="tertiary" size="sm" className="subpage-back-button" onClick={()=>{setPage('gallery');}}><ArrowLeft size={16} aria-hidden="true"/>Back to Gallery</Button><h2>Compare photos</h2></div></header>
      {current&&<section className="panel photo-viewer-panel"><div className="section-heading"><div><h2>{current.date}</h2><p>Set {viewerIndex+1} of {sets.length}{hasMore?' · More older sets available':''}</p></div></div>
        <SegmentedControl<PhysiqueAngle> className="photo-angle-selector" label="Photo angle" value={viewerAngle} onChange={setViewerAngle} options={angles.map(angle=>({value:angle,label:angleLabel(angle)}))}/>
        <div className="photo-viewer-image">{photo?<img src={`/api/photos/${photo.id}/content`} alt={`${angleLabel(viewerAngle)} physique photo from ${current.date}`}/>:<div className="photo-slot-empty"><strong>{angleLabel(viewerAngle)}</strong><span>Not uploaded</span></div>}</div>
        {adjacent?.photos.find(item=>item.angle===viewerAngle)&&<img className="photo-adjacent-preload" src={`/api/photos/${adjacent.photos.find(item=>item.angle===viewerAngle)!.id}/content`} alt="" aria-hidden="true"/>}
        <div className="modal-actions photo-viewer-actions"><Button variant="secondary" disabled={viewerIndex===0} onClick={goNewer}>Newer set</Button><Button variant="secondary" disabled={!hasMore&&viewerIndex===sets.length-1} onClick={()=>void goOlder()}>Older set</Button></div>
      </section>}
    </>;
  }

  return <>
    <section className="panel physique physique-photo-home"><div className="section-heading"><div><h2>Body tracking & progress</h2><p>Measurements, circumference tracking, weight context, and private physique photos.</p></div></div>
      <div className="body-hub-grid">
        <article className="body-hub-card">
          <div className="body-hub-card-header">
            <div className="body-hub-icon-wrap" aria-hidden="true"><Scale size={20}/></div>
            <div>
              <h3>Measurements & records</h3>
              <p>Track circumference across core, arms, and legs alongside body fat and server weight snapshots.</p>
            </div>
          </div>
          <div className="body-hub-card-footer">
            <Button variant="primary" onClick={event=>openBodyEditor(undefined,event.currentTarget)}>Add body record</Button>
            <Button variant="secondary" onClick={openHistory}>Open history</Button>
          </div>
        </article>
        <article className="body-hub-card">
          <div className="body-hub-card-header">
            <div className="body-hub-icon-wrap" aria-hidden="true"><Camera size={20}/></div>
            <div>
              <h3>Physique photos & gallery</h3>
              <p>Private front, side, and back visual progress with historical comparison timeline.</p>
            </div>
          </div>
          <div className="body-hub-card-footer">
            <Button variant="secondary" onClick={event=>{setEditingSet(undefined);setUploadReturnFocus(event.currentTarget);setUploadOpen(true);}}>Add photo set</Button>
            <Button variant="secondary" onClick={openGallery}>Open gallery</Button>
          </div>
        </article>
      </div>
      <div className="body-hub-compare-cta" style={{marginTop:'16px',display:'flex',justifyContent:'flex-end'}}>
        <Button variant="secondary" size="md" onClick={()=>openCompare(0)}><ArrowLeftRight size={16} aria-hidden="true"/>Compare past & present</Button>
      </div>
      {loaded&&<p className="source body-hub-status">{sets.length} legacy photo {sets.length===1?'set':'sets'} loaded · {number((store.local?.photoDrafts?.length??0))} retained upload{drafts.length===1?'':'s'}</p>}
      {!store.local?.photoDrafts?.length&&!bodyDrafts.length&&<p className="source body-hub-status">Retained entries and upload status appear here when a connection is unavailable.</p>}
    </section>
    {drafts.map(draft=><div className="notice" key={draft.id}><p>{draft.date} · {draft.photos.map(photo=>angleLabel(photo.angle)).join(', ')||'No views'} · {draft.error??'Uploading when connected.'}</p><div className="actions">{draft.error&&<Button onClick={()=>void store.retryPhoto(draft.id)}>Retry photo set</Button>}<Button variant="tertiary" onClick={()=>void store.removePhotoDraft(draft.id)}>Discard local photo set</Button></div></div>)}
    {bodyDrafts.map(draft=><BodyDraftNotice key={draft.id} draft={draft} store={store}/>)}
    <PhotoUploadDialog open={uploadOpen} store={store} initial={editingSet} restoreFocus={uploadReturnFocus} onClose={closeUpload} onChanged={()=>void loadPage(true)}/>
    <BodyRecordDialog open={bodyOpen} record={bodyEditor} store={store} restoreFocus={bodyReturnFocus} onClose={closeBodyEditor}/>
  </>;
}

function BodyHistoryRow({record,onOpen,onEdit}:{record:BodyRecord;onOpen:()=>void;onEdit:(trigger:HTMLElement)=>void}){
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

function BodyRecordViewer({record,previous,angle,onAngle,weightUnit}:{record:BodyRecord;previous?:BodyRecord;angle:PhysiqueAngle;onAngle:(angle:PhysiqueAngle)=>void;weightUnit:'kg'|'lb'}){
  const photo=record.photos.find(item=>item.angle===angle&&item.status==='complete');
  const difference=(key:BodyMeasurementKey)=>{
    const current=record.measurements[key];const older=previous?.measurements[key];
    if(current==null||older==null)return null;
    return current-older;
  };
  return <section className="panel body-viewer-panel">
    <div className="section-heading"><div><h2>{record.date}</h2><p>Revision {record.revision} · {record.weightContext.provenance==='legacy-unavailable'?'Weight snapshot unavailable':'Weight snapshot captured on the server'}{previous?' · Compared with '+previous.date:''}</p></div></div>
    <div className="body-viewer-layout">
      <div className="body-viewer-photo-column">
        <SegmentedControl<PhysiqueAngle> className="photo-angle-selector" label="Photo angle" value={angle} onChange={onAngle} options={angles.map(value=>({value,label:angleLabel(value)}))}/>
        <div className="photo-viewer-image">{photo?<img src={'/api/photos/'+photo.id+'/content'} alt={angleLabel(angle)+' physique photo from '+record.date}/>:<div className="photo-slot-empty"><strong>{angleLabel(angle)}</strong><span>{record.photos.find(item=>item.angle===angle)?.status==='pending'?'Upload pending':'Not uploaded'}</span></div>}</div>
      </div>
      <div className="body-measurement-summary">
        <div className="body-summary-heading"><h3>Measurements</h3><span>cm</span></div>
        {measurementGroups.map(([group,keys])=><div className="body-measurement-group" key={group}><h4>{group}</h4>{keys.map(key=><MeasurementLine key={key} label={measurementLabel(key)} value={record.measurements[key]} difference={difference(key)}/>)}</div>)}
        <MeasurementLine label="Body fat" value={record.measurements.bodyFatPercent} difference={difference('bodyFatPercent')} suffix="%" bodyFat/>
        <div className="body-weight-context"><h4>Weight context</h4><p>Scale {record.weightContext.scaleKg==null?'—':displayWeight(record.weightContext.scaleKg,weightUnit,1)+' '+weightLabel(weightUnit)}{record.weightContext.scaleDate?' · '+record.weightContext.scaleDate:''}</p><p>Trend {record.weightContext.trendKg==null?'—':displayWeight(record.weightContext.trendKg,weightUnit,1)+' '+weightLabel(weightUnit)}{record.weightContext.trendDate?' · '+record.weightContext.trendDate:''}</p></div>
      </div>
    </div>
  </section>;
}

function MeasurementLine({label,value,difference,suffix='',bodyFat=false}:{label:string;value:number|null;difference:number|null;suffix?:string;bodyFat?:boolean}){
  const delta=difference==null?'':' ('+(difference>0?'+':'')+number(difference,1)+(bodyFat?' pp':'')+')';
  return <div className="body-measurement-line"><span>{label}</span><strong>{value==null?'—':number(value,1)+suffix}{delta&&<small className="body-measurement-difference">{delta}</small>}</strong></div>;
}

function BodyDraftNotice({draft,store}:{draft:BodyDraft;store:Nourish}){
  const count=Object.values(draft.measurements).filter(value=>value!=null).length;
  const detail=draft.action==='delete'?'Delete pending':count+' measurement'+(count===1?'':'s')+(draft.photos.length?' · '+draft.photos.length+' photo'+(draft.photos.length===1?'':'s'):'');
  return <div className="notice body-draft-notice"><p>{draft.date} · {detail} · {draft.error??'Saved locally; syncing when connected.'}</p><div className="actions">{draft.error&&<Button onClick={()=>void store.retryBody(draft.id)}>Retry Body record</Button>}<Button variant="tertiary" onClick={()=>void store.removeBodyDraft(draft.id)}>Discard local Body record</Button></div></div>;
}

function PhotoSetRow({set,onEdit}:{set:PhysiquePhotoSet;onEdit:(set:PhysiquePhotoSet,trigger:HTMLElement)=>void}){
  return <article className="photo-gallery-row"><div className="photo-gallery-row-heading"><h3>{set.date}</h3><Button variant="tertiary" onClick={event=>onEdit(set,event.currentTarget)}>Edit</Button></div><div className="photo-gallery-previews">{angles.map(angle=>{
    const photo=set.photos.find(item=>item.angle===angle);
    return <figure key={angle}>{photo?<LazyPhoto photo={photo} label={angleLabel(angle)+' view from '+set.date}/>:<div className="photo-slot-empty"><strong>{angleLabel(angle)}</strong><span>Not uploaded</span></div>}<figcaption>{angleLabel(angle)}{!photo?' · Not uploaded':''}</figcaption></figure>;
  })}</div></article>;
}

function LazyPhoto({photo,label}:{photo:PhysiquePhoto;label:string}){
  const ref=useRef<HTMLDivElement>(null);const [near,setNear]=useState(false);
  useEffect(()=>{
    if(!ref.current)return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setNear(true);observer.disconnect();}},{rootMargin:'240px'});
    observer.observe(ref.current);return()=>observer.disconnect();
  },[]);
  return <div ref={ref} className="photo-lazy-frame">{near?<img loading="lazy" src={`/api/photos/${photo.id}/content`} alt={label}/>:<div className="photo-lazy-placeholder" aria-label={`Loading ${label}`}/>}</div>;
}

import {useCallback,useEffect,useRef,useState,type ChangeEvent, type FormEvent} from 'react';
import {ArrowLeft,Camera,Scale} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {BodyDraft,BodyMeasurementKey,BodyPage,BodyRecord,BodyWeightContext,PhysiqueAngle,PhysiquePhoto,PhysiquePhotoPage,PhysiquePhotoSet} from '../types';
import {api} from '../lib/api';
import {number,today} from '../lib/format';
import {Button} from './ui/Button';
import {Checkbox} from './ui/Checkbox';
import {Modal} from './ui/Modal';
import {SegmentedControl} from './ui/SegmentedControl';
import {PhotoUploadDialog} from './PhotoUploadDialog';
import {useAsyncAction} from './ui/useAsyncAction';
import {Form} from './ui/Form';
import {DatePicker} from './ui/DatePicker';
import {Field} from './ui/Field';
import {FileInput} from './ui/FileInput';
import {prepareImage} from '../lib/image';
import {displayWeight,unitsFor,weightLabel} from '../lib/units';

const angles:PhysiqueAngle[]=['front','side','back'];
const angleLabel=(angle:PhysiqueAngle)=>angle[0].toUpperCase()+angle.slice(1);
const measurementGroups:[string,BodyMeasurementKey[]][]=[
  ['Core',['neckCm','shouldersCm','chestCm','waistCm','hipsCm']],
  ['Arms',['leftBicepsCm','rightBicepsCm','leftForearmCm','rightForearmCm']],
  ['Legs',['leftThighCm','rightThighCm','leftCalfCm','rightCalfCm']]
];
const measurementLabel=(key:BodyMeasurementKey)=>({neckCm:'Neck',shouldersCm:'Shoulders',chestCm:'Chest',waistCm:'Waist',hipsCm:'Hips',leftBicepsCm:'Left biceps',rightBicepsCm:'Right biceps',leftForearmCm:'Left forearm',rightForearmCm:'Right forearm',leftThighCm:'Left thigh',rightThighCm:'Right thigh',leftCalfCm:'Left calf',rightCalfCm:'Right calf',bodyFatPercent:'Body fat'}[key]);
const allMeasurementKeys:BodyMeasurementKey[]=measurementGroups.flatMap(([,keys])=>keys).concat('bodyFatPercent');
const toCm=(value:number,unit:'cm'|'in')=>unit==='in'?value*2.54:value;
const measurementCount=(record:BodyRecord)=>allMeasurementKeys.filter(key=>record.measurements[key]!=null).length;
async function captureBodyContext(store:Nourish,date:string):Promise<BodyWeightContext>{
  if(navigator.onLine){
    try{return await api<BodyWeightContext>('/body-records/weight-context?date='+encodeURIComponent(date));}catch{/* Fall back to the retained local values below. */}
  }
  const state=store.state;
  const scale=[...(state?.weights??[])].filter(weight=>!weight.deleted&&weight.date<=date).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
  const cachedPoints=Object.values(store.local?.progress??{}).flatMap(summary=>summary.weight.series).filter(point=>point.date<=date).sort((a,b)=>a.date.localeCompare(b.date));
  const trend=cachedPoints.at(-1);
  return {scaleKg:scale?.kg??null,scaleDate:scale?.date??null,trendKg:trend?.trendKg??null,trendDate:trend?.date??null,capturedAt:new Date().toISOString(),calculationVersion:'coach-trend-half-life-7d-v1',provenance:'cached'};
}

export function PhysiquePhotos({store}:{store:Nourish}){
  const [page,setPage]=useState<'home'|'history'|'body-viewer'|'gallery'|'viewer'>('home');
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
  const [nextCursor,setNextCursor]=useState<string|null>(null);
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
      cursorRef.current=response.nextCursor;setNextCursor(response.nextCursor);setHasMore(response.hasMore);setLoaded(true);
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
    if(page==='history'&&!bodyLoaded)void loadBodyPage(true);
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
  const goOlder=async()=>{
    if(viewerIndex+1<sets.length){setViewerIndex(index=>index+1);return;}
    if(!hasMore)return;
    const count=await loadPage(false);
    if(count>0)setViewerIndex(index=>index+1);
  };
  const goNewer=()=>{if(viewerIndex>0)setViewerIndex(index=>index-1);};
  const openBodyViewer=(index:number)=>{setBodyViewerIndex(index);setBodyViewerAngle('front');setPage('body-viewer');};
  const openBodyCompare=()=>{
    const index=bodyRecords.findIndex(record=>record.photos.some(photo=>photo.status==='complete'||photo.status==='pending'));
    openBodyViewer(index<0?0:index);
  };
  const goBodyOlder=()=>{if(bodyViewerIndex+1<bodyRecords.length)setBodyViewerIndex(index=>index+1);};
  const goBodyNewer=()=>{if(bodyViewerIndex>0)setBodyViewerIndex(index=>index-1);};

  const drafts=store.local?.photoDrafts??[];
  const bodyDrafts=store.local?.bodyDrafts??[];
  const viewer=page==='viewer';
  if(page==='history')return <>
    <header className="page-heading photo-view-heading"><div className="subpage-header-title"><Button variant="tertiary" size="sm" className="subpage-back-button" onClick={closeHistory}><ArrowLeft size={16} aria-hidden="true"/>Back to Body</Button><h2>Body history</h2></div><Button variant="primary" onClick={event=>openBodyEditor(undefined,event.currentTarget)}>Add body record</Button></header>
    {bodyError&&<p className="notice" role="status">{bodyError} <Button onClick={()=>void loadBodyPage(!bodyRecords.length)}>Retry history</Button></p>}
    <section className="panel body-history-panel">
      <div className="section-heading"><div><h2>Measurements and photos</h2><p>Records are ordered by date. Weight attachments are server snapshots.</p></div><Button variant="secondary" disabled={!bodyRecords.length} onClick={openBodyCompare}>Compare</Button></div>
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
      <header className="page-heading photo-view-heading"><div className="subpage-header-title"><Button variant="tertiary" size="sm" className="subpage-back-button" onClick={()=>setPage('history')}><ArrowLeft size={16} aria-hidden="true"/>Back to Body history</Button><h2>Body record</h2></div><Button variant="secondary" onClick={event=>openBodyEditor(current,event.currentTarget)}>Edit record</Button></header>
      {current&&<BodyRecordViewer record={current} previous={bodyRecords[bodyViewerIndex+1]} angle={bodyViewerAngle} onAngle={setBodyViewerAngle} weightUnit={unitsFor(store.state!.settings).weight}/>}
      <div className="modal-actions body-history-nav"><Button variant="secondary" disabled={bodyViewerIndex===0} onClick={goBodyNewer}>Newer record</Button><Button variant="secondary" disabled={bodyViewerIndex===bodyRecords.length-1} onClick={goBodyOlder}>Older record</Button></div>
    </>;
  }

  if(page==='gallery')return <>
    <header className="page-heading photo-view-heading"><div className="subpage-header-title"><Button variant="tertiary" size="sm" className="subpage-back-button" onClick={closeGallery}><ArrowLeft size={16} aria-hidden="true"/>Back to Body</Button><h2>Gallery</h2></div><Button variant="primary" onClick={event=>{setEditingSet(undefined);setUploadReturnFocus(event.currentTarget);setUploadOpen(true);}}>Add photo set</Button></header>
    {error&&<p className="notice" role="status">{error} <Button onClick={()=>void loadPage(!sets.length)}>Retry gallery</Button></p>}
    <section className="panel physique-gallery-panel">
      <div className="section-heading"><div><h2>Compare</h2><p>Newest sets appear first. Missing views stay missing.</p></div><Button variant="secondary" disabled={!sets.length} onClick={openViewer}>Compare</Button></div>
      {!sets.length&&!error&&<p className="empty">{loaded?'No photo sets yet.':'Loading gallery…'}</p>}
      <div className="photo-gallery-list">{sets.map(set=><PhotoSetRow key={set.id} set={set} onEdit={openEdit}/>)}</div>
      {hasMore&&<div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={()=>void loadPage(false)}>{busy?'Loading…':'Load more'}</Button></div>}
    </section>
    {drafts.map(draft=><div className="notice" key={draft.id}><p>{draft.date} · {draft.photos.map(photo=>angleLabel(photo.angle)).join(', ')||'No views'} · {draft.error??'Uploading when connected.'}</p><div className="actions">{draft.error&&<Button onClick={()=>void store.retryPhoto(draft.id)}>Retry photo set</Button>}<Button variant="tertiary" onClick={()=>void store.removePhotoDraft(draft.id)}>Discard local photo set</Button></div></div>)}
    <PhotoUploadDialog open={uploadOpen} store={store} initial={editingSet} restoreFocus={uploadReturnFocus} onClose={closeUpload} onChanged={()=>void loadPage(true)}/>
  </>;

  if(viewer){
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

interface BodyRecordDialogProps{open:boolean;record?:BodyRecord;store:Nourish;restoreFocus?:HTMLElement|null;onClose:()=>void}
type BodySlot={angle:PhysiqueAngle;id:string;existing?:PhysiquePhoto;imageBase64?:string;changed:boolean;deleted:boolean;fileKey:number};

function BodyRecordDialog({open,record,store,restoreFocus,onClose}:BodyRecordDialogProps){
  const current=today(store.state!.profile?.timeZone);
  const defaultUnit=unitsFor(store.state!.settings).weight==='lb'?'in':'cm';
  const [date,setDate]=useState(current);
  const [unit,setUnit]=useState<'cm'|'in'>(defaultUnit);
  const [values,setValues]=useState<Record<BodyMeasurementKey,string>>(()=>Object.fromEntries(allMeasurementKeys.map(key=>[key,''])) as Record<BodyMeasurementKey,string>);
  const [slots,setSlots]=useState<BodySlot[]>(()=>makeBodySlots());
  const [omitScale,setOmitScale]=useState(false);
  const [omitTrend,setOmitTrend]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [error,setError]=useState('');
  const {busy,run,reset}=useAsyncAction();
  const initialRef=useRef({date,values,slots});
  useEffect(()=>{
    if(!open)return;
    const nextValues=Object.fromEntries(allMeasurementKeys.map(key=>[key,record?.measurements[key]==null?'':String(record.measurements[key])])) as Record<BodyMeasurementKey,string>;
    const nextSlots=makeBodySlots(record);
    setDate(record?.date??current);setUnit(defaultUnit);setValues(nextValues);setSlots(nextSlots);setOmitScale(false);setOmitTrend(false);setConfirmDelete(false);setError('');reset();
    initialRef.current={date:record?.date??current,values:nextValues,slots:nextSlots};
  },[open,record?.id,current,defaultUnit,reset]);
  const dirty=date!==initialRef.current.date||allMeasurementKeys.some(key=>values[key]!==initialRef.current.values[key])||slots.some(slot=>slot.changed||slot.deleted);
  const select=async(angle:PhysiqueAngle,event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.currentTarget.files?.[0];event.currentTarget.value='';
    if(!file)return;
    setError('');
    try{const imageBase64=await run(()=>prepareImage(file,750000));setSlots(currentSlots=>currentSlots.map(slot=>slot.angle===angle?{...slot,imageBase64,changed:true,deleted:false}:slot));}
    catch(ex){setError((ex as Error).message);}
  };
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;
    const measurements:Record<string,number|null>={};
    for(const key of allMeasurementKeys){
      const raw=values[key].trim();
      if(!record&&raw==='')continue;
      measurements[key]=raw===''?null:Number(raw);
    }
    const photos=slots.filter(slot=>slot.changed&&slot.imageBase64).map(slot=>({id:slot.id,angle:slot.angle,imageBase64:slot.imageBase64!}));
    const deletePhotoIds=slots.filter(slot=>slot.deleted&&slot.existing).map(slot=>slot.existing!.id);
    if(!record&&Object.keys(measurements).length===0&&photos.length===0){setError('Add at least one measurement or photo before saving.');return;}
    setError('');
    try{
      const weightContext=record?undefined:await captureBodyContext(store,date);
      const draft:BodyDraft={id:record?.id??crypto.randomUUID(),date,measurements,photos,deletePhotoIds,mutationId:crypto.randomUUID(),photoMutationId:photos.length?crypto.randomUUID():undefined,deleteMutationIds:Object.fromEntries(deletePhotoIds.map(id=>[id,crypto.randomUUID()])),weightContext,omitScale,omitTrend,expectedRevision:record?.revision??0};
      await run(()=>store.saveBodyDraft(draft));onClose();
    }catch(ex){setError((ex as Error).message);}
  };
  const deleteRecord=async()=>{
    if(!record)return;
    setError('');
    try{
      const draft:BodyDraft={id:record.id,date:record.date,measurements:{},photos:[],action:'delete',mutationId:crypto.randomUUID(),expectedRevision:record.revision};
      await run(()=>store.saveBodyDraft(draft));setConfirmDelete(false);onClose();
    }catch(ex){setError((ex as Error).message);}
  };
  return <Modal open={open} onClose={onClose} restoreFocus={restoreFocus} title={record?'Edit Body record':'Add Body record'} description="Measurements are stored in centimetres. Weight context is captured once by the server and remains reviewable." dirty={dirty} width="xl">
    <Form onSubmit={save} className="dialog-form body-record-form">
      <div className="body-record-form-top">
        <DatePicker id="body-date" name="date" min="2000-01-01" max={current} required label="Record date" value={date} onChange={setDate}/>
        <div className="field body-unit-toggle-field">
          <span>Circumference unit</span>
          <SegmentedControl<'cm'|'in'> id="body-circumference-unit" label="Circumference unit" value={unit} onChange={setUnit} options={[{value:'cm',label:'Centimetres (cm)'},{value:'in',label:'Inches (in)'}]}/>
        </div>
      </div>
      {measurementGroups.map(([group,keys])=><section className="body-form-section" key={group}>
        <div className="body-form-section-header"><h3>{group}</h3><span className="unit-indicator">{unit}</span></div>
        <div className="body-field-grid">{keys.map(key=><Field key={key} id={'body-'+key} type="number" min="0.1" max="400" step="0.1" label={measurementLabel(key)+' ('+unit+')'} value={values[key]===''?'':unit==='cm'?values[key]:String(Number(values[key])/2.54)} onChange={event=>{const raw=event.currentTarget.value;setValues(currentValues=>({...currentValues,[key]:raw===''?'':String(toCm(Number(raw),unit))}));}}/>)}</div>
      </section>)}
      <section className="body-form-section">
        <div className="body-form-section-header"><h3>Composition</h3><span className="unit-indicator">%</span></div>
        <div className="body-field-grid body-composition-grid"><Field id="body-bodyFatPercent" type="number" min="0.1" max="99.9" step="0.1" label="Body fat (%)" value={values.bodyFatPercent} onChange={event=>setValues(currentValues=>({...currentValues,bodyFatPercent:event.currentTarget.value}))}/></div>
      </section>
      <section className="body-form-section body-context-section">
        <div className="body-form-section-header"><h3>Weight context</h3><p className="source">Captured when this record is saved. Missing values stay unavailable.</p></div>
        <div className="body-context-switches">
          <Checkbox id="body-omit-scale" role="switch" checked={omitScale} onChange={setOmitScale}>Omit scale snapshot</Checkbox>
          <Checkbox id="body-omit-trend" role="switch" checked={omitTrend} onChange={setOmitTrend}>Omit trend snapshot</Checkbox>
        </div>
      </section>
      <section className="body-form-section body-photo-section">
        <div className="body-form-section-header"><h3>Photos</h3><p className="source">Optional. Replace or remove one view without changing the other angles.</p></div>
        <div className="physique-upload-grid">{slots.map(slot=>{const preview=slot.imageBase64?'data:image/jpeg;base64,'+slot.imageBase64:slot.existing&&!slot.deleted?'/api/photos/'+slot.existing.id+'/content':undefined;return <section className="physique-upload-slot" key={slot.angle}><div className="physique-upload-slot-heading"><h4>{angleLabel(slot.angle)}</h4>{slot.existing&&!slot.deleted&&!slot.changed&&<Button type="button" variant="destructive" size="sm" disabled={busy} onClick={()=>setSlots(currentSlots=>currentSlots.map(item=>item.angle===slot.angle?{...item,deleted:true}:item))}>Delete</Button>}</div>{preview&&<img className="photo-preview" src={preview} alt={(slot.changed?'Selected':'Current')+' '+slot.angle+' physique photo'}/>}<FileInput id={'body-photo-'+slot.angle} name={'body-photo-'+slot.angle} key={slot.fileKey} disabled={busy} label={angleLabel(slot.angle)+' photo'} accept="image/*" hint="JPEG or PNG; ≤750 KB." onChange={event=>void select(slot.angle,event)}/></section>})}</div>
      </section>
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions">{record&&<Button type="button" variant="destructive" disabled={busy} onClick={()=>setConfirmDelete(true)}>Delete record</Button>}<Button type="submit" variant="primary" disabled={busy}>{busy?'Preparing…':'Save Body record'}</Button></div>
    </Form>
    <Modal open={confirmDelete} onClose={()=>setConfirmDelete(false)} title="Delete Body record?" description="The record and its private photo views will be marked for deletion. You can retry cleanup if storage is unavailable." width="sm"><div className="modal-actions"><Button variant="secondary" onClick={()=>setConfirmDelete(false)}>Keep record</Button><Button variant="destructive" disabled={busy} onClick={()=>void deleteRecord()}>Delete record</Button></div></Modal>
  </Modal>;
}

function makeBodySlots(record?:BodyRecord):BodySlot[]{
  return angles.map(angle=>{const existing=record?.photos.find(photo=>photo.angle===angle&&photo.status!=='deleted');return {angle,id:existing?.id??crypto.randomUUID(),existing,changed:false,deleted:false,fileKey:0};});
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

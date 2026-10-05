import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Camera,Scale,ArrowLeftRight} from 'lucide-react';
import type {NutritionStore} from '../useNutritionStore';
import type {BodyPage,BodyRecord,PhysiqueAngle,PhysiquePhotoPage,PhysiquePhotoSet} from '../types';
import {api} from '../lib/api';
import {clampIndex} from '../lib/bodyMeasurements';
import {Button} from './ui/Button';
import {PhotoUploadDialog} from './PhotoUploadDialog';
import {unitsFor} from '../lib/units';
import {CardFeedback} from './ui/CardFeedback';
import {MotionPanel} from './ui/Motion';
import {BodyCompare} from './BodyCompare';
import {BodyRecordDialog} from './BodyRecordDialog';
import {BodyRecordViewer} from './body/BodyRecordViewer';
import {PhotoSetViewer} from './body/PhotoSetViewer';
import {BodyDraftNotice,BodyHistoryRow,BodyListSkeleton,PhotoDraftNotice,PhotoSetRow} from './body/BodyListRows';
import './body/body.css';

type BodyView='home'|'history'|'body-viewer'|'gallery'|'viewer'|'compare';

export function PhysiquePhotos({store}:{store:NutritionStore}){
  const [page,setPage]=useState<BodyView>('home');
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
  const [bodyLoading,setBodyLoading]=useState(false);
  const [photoLoading,setPhotoLoading]=useState(false);
  const bodyLoadingRef=useRef(false);
  const busy=bodyLoading||photoLoading;
  const busyPending=busy;

  const bodyRead=useRef(0);
  const photoRead=useRef(0);
  const loadBodyPage=useCallback(async(reset=false)=>{
    if(bodyLoadingRef.current&&!reset)return 0;
    const request=++bodyRead.current;bodyLoadingRef.current=true;setBodyLoading(true);
    if(reset)setBodyError('');
    try{
      const cursor=reset?null:bodyCursor;
      const response=await api<BodyPage>('/body-records'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
      if(request!==bodyRead.current)return 0;
      setBodyCursor(response.nextCursor);setBodyHasMore(response.hasMore);setBodyLoaded(true);
      setBodyRecords(current=>{
        if(reset)return response.records;
        const byId=new Map(current.map(item=>[item.id,item]));response.records.forEach(item=>byId.set(item.id,item));return [...byId.values()];
      });
      return response.records.length;
    }catch(ex){if(request!==bodyRead.current)return 0;setBodyError((ex as Error).message);return 0;}
    finally{if(request===bodyRead.current){bodyLoadingRef.current=false;setBodyLoading(false);}}
  },[bodyCursor]);

  const loadPage=useCallback(async(reset=false)=>{
    if(loadingRef.current&&!reset)return 0;
    const request=++photoRead.current;
    loadingRef.current=true;setPhotoLoading(true);setError('');
    try{
      const cursor=reset?null:cursorRef.current;
      const response=await api<PhysiquePhotoPage>('/photos?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
      if(request!==photoRead.current)return 0;
      cursorRef.current=response.nextCursor;setHasMore(response.hasMore);setLoaded(true);
      setSets(current=>{
        if(reset)return response.sets;
        const byId=new Map(current.map(item=>[item.id,item]));
        response.sets.forEach(item=>byId.set(item.id,item));
        return [...byId.values()];
      });
      return response.sets.length;
    }catch(ex){if(request!==photoRead.current)return 0;setError((ex as Error).message);return 0;}
    finally{if(request===photoRead.current){loadingRef.current=false;setPhotoLoading(false);}}
  },[]);

  useEffect(()=>{
    if(page==='gallery'&&!loaded)void loadPage(true);
    if((page==='history'||page==='compare')&&!bodyLoaded)void loadBodyPage(true);
    if(page==='gallery'){
      const frame=window.requestAnimationFrame(()=>window.scrollTo({top:galleryScroll.current,behavior:'auto'}));
      return()=>window.cancelAnimationFrame(frame);
    }
  },[page,loaded,loadPage,bodyLoaded,loadBodyPage]);

  useEffect(()=>()=>{++bodyRead.current;++photoRead.current;},[]);
  useEffect(()=>{
    const completed=()=>{void loadBodyPage(true);void loadPage(true);};
    window.addEventListener('nutrition:body-saved',completed);
    return()=>window.removeEventListener('nutrition:body-saved',completed);
  },[loadBodyPage,loadPage]);

  // A deleted record or a reload can shorten the list under an open viewer.
  const bodyIndex=clampIndex(bodyViewerIndex,bodyRecords.length);
  const rememberGallery=()=>{galleryScroll.current=window.scrollY;};
  const openGallery=()=>{galleryScroll.current=0;setPage('gallery');};
  const closeGallery=()=>{rememberGallery();setPage('home');};
  const openHistory=()=>{setPage('history');void loadBodyPage(true);};
  const openBodyEditor=(record:BodyRecord|undefined,trigger?:HTMLElement|null)=>{setBodyEditor(record);setBodyReturnFocus(trigger??null);setBodyOpen(true);};
  const closeBodyEditor=()=>{setBodyOpen(false);setBodyEditor(undefined);void loadBodyPage(true);};
  const openUpload=(set:PhysiquePhotoSet|undefined,trigger:HTMLElement)=>{setEditingSet(set);setUploadReturnFocus(trigger);setUploadOpen(true);};
  const closeUpload=()=>{setUploadOpen(false);setEditingSet(undefined);void loadPage(true);};
  const openViewer=()=>{if(!sets.length)return;rememberGallery();setViewerIndex(0);setViewerAngle('front');setPage('viewer');};
  const goOlder=async()=>{if(viewerIndex+1<sets.length){setViewerIndex(index=>index+1);return;}if(!hasMore)return;const count=await loadPage(false);if(count>0)setViewerIndex(index=>index+1);};
  const openBodyViewer=(index:number)=>{setBodyViewerIndex(index);setBodyViewerAngle('front');setPage('body-viewer');};
  const openCompare=(targetIndex=0)=>{setBodyViewerIndex(targetIndex);setPage('compare');};

  const drafts=store.local?.photoDrafts??[];
  const bodyDrafts=store.local?.bodyDrafts??[];
  const weightUnit=unitsFor(store.state!.settings).weight;
  const retained=drafts.length+bodyDrafts.length;
  const back=(label:string,onClick:()=>void)=><Button variant="tertiary" size="sm" className="subpage-back-button" onClick={onClick}><ArrowLeft size={16} aria-hidden="true"/>{label}</Button>;

  let view: React.ReactNode;
  if(page==='compare'){
    view=<BodyCompare records={bodyRecords} initialPresentIndex={bodyIndex} initialPastIndex={bodyRecords.length>1?bodyRecords.length-1:0} weightUnit={weightUnit} onBack={()=>setPage('history')} onEditRecord={rec=>openBodyEditor(rec)}/>;
  }else if(page==='history'){
    view=<>
      <header className="page-heading photo-view-heading"><div className="subpage-header-title">{back('Back to Body',()=>setPage('home'))}<h2>Body history</h2></div><Button variant="primary" onClick={event=>openBodyEditor(undefined,event.currentTarget)}>Add body record</Button></header>
      {bodyError&&<CardFeedback title="Body history unavailable" message={bodyError} action={{label:'Retry history',onClick:()=>void loadBodyPage(!bodyRecords.length),disabled:busy}}/>}
      <section className="panel body-history-panel">
        <div className="section-heading"><div><h2>Measurements and photos</h2><p>Newest first.</p></div><Button variant="secondary" disabled={bodyRecords.length<2} onClick={()=>openCompare(0)}><ArrowLeftRight size={16} aria-hidden="true"/>Compare</Button></div>
        {!bodyRecords.length&&!bodyError&&(bodyLoaded?<p className="empty">No Body records yet.</p>:<BodyListSkeleton kind="history" label="Loading Body history…"/>)}
        <div className="body-history-list">{bodyRecords.map((record,index)=><BodyHistoryRow key={record.id} record={record} onOpen={()=>openBodyViewer(index)} onEdit={trigger=>openBodyEditor(record,trigger)}/>)}</div>
        {bodyHasMore&&<div className="modal-actions"><Button variant="secondary" disabled={busyPending} onClick={()=>void loadBodyPage(false)}>{busy?'Loading…':'Load more'}</Button></div>}
      </section>
      {bodyDrafts.map(draft=><BodyDraftNotice key={draft.mutationId} draft={draft} store={store}/>)}
    </>;
  }else if(page==='body-viewer'){
    const current=bodyRecords[bodyIndex];
    view=<>
      <header className="page-heading photo-view-heading"><div className="subpage-header-title">{back('Back to Body history',()=>setPage('history'))}<h2>Body record</h2></div><div className="physique-hub-actions"><Button variant="secondary" disabled={bodyRecords.length<2} onClick={()=>openCompare(bodyIndex)}><ArrowLeftRight size={16} aria-hidden="true"/>Compare</Button><Button variant="secondary" disabled={!current} onClick={event=>openBodyEditor(current,event.currentTarget)}>Edit record</Button></div></header>
      {current?<BodyRecordViewer records={bodyRecords} index={bodyIndex} angle={bodyViewerAngle} weightUnit={weightUnit} onAngle={setBodyViewerAngle} onIndex={setBodyViewerIndex}/>:<p className="empty">No Body records yet.</p>}
    </>;
  }else if(page==='gallery'){
    view=<>
      <header className="page-heading photo-view-heading"><div className="subpage-header-title">{back('Back to Body',closeGallery)}<h2>Gallery</h2></div><Button variant="primary" onClick={event=>openUpload(undefined,event.currentTarget)}>Add photo set</Button></header>
      {error&&<CardFeedback title="Photo gallery unavailable" message={error} action={{label:'Retry gallery',onClick:()=>void loadPage(!sets.length),disabled:busy}}/>}
      <section className="panel physique-gallery-panel">
        <div className="section-heading"><div><h2>Photo sets</h2><p>Newest first.</p></div><Button variant="secondary" disabled={!sets.length} onClick={openViewer}><ArrowLeftRight size={16} aria-hidden="true"/>Step through sets</Button></div>
        {!sets.length&&!error&&(loaded?<p className="empty">No photo sets yet.</p>:<BodyListSkeleton kind="gallery" label="Loading gallery…"/>)}
        <div className="photo-gallery-list">{sets.map(set=><PhotoSetRow key={set.id} set={set} onEdit={openUpload}/>)}</div>
        {hasMore&&<div className="modal-actions"><Button variant="secondary" disabled={busyPending} onClick={()=>void loadPage(false)}>{busy?'Loading…':'Load more'}</Button></div>}
      </section>
      {drafts.map(draft=><PhotoDraftNotice key={draft.versionId??draft.id} draft={draft} store={store}/>)}
    </>;
  }else if(page==='viewer'){
    view=<>
      <header className="page-heading photo-view-heading"><div className="subpage-header-title">{back('Back to Gallery',()=>setPage('gallery'))}<h2>Photo sets</h2></div></header>
      <PhotoSetViewer sets={sets} index={viewerIndex} angle={viewerAngle} hasMore={hasMore} busy={busy} onAngle={setViewerAngle} onOlder={()=>void goOlder()} onNewer={()=>setViewerIndex(index=>Math.max(0,index-1))}/>
    </>;
  }else{
    view=<>
      <section className="panel physique physique-photo-home"><div className="section-heading"><div><h2>Body</h2></div></div>
        <div className="body-hub-grid">
          <article className="body-hub-card">
            <div className="body-hub-card-header">
              <div className="body-hub-icon-wrap" aria-hidden="true"><Scale size={20}/></div>
              <div>
                <h3>Measurements & records</h3>
                <p>Measurements, body fat, photos, and weight.</p>
              </div>
            </div>
            <div className="body-hub-card-footer">
              <Button variant="primary" aria-label="Add body record" onClick={event=>openBodyEditor(undefined,event.currentTarget)}><span className="tab-label-full">Add body record</span><span className="tab-label-short">Add record</span></Button>
              <Button variant="secondary" onClick={openHistory}>Open history</Button>
            </div>
          </article>
          <article className="body-hub-card">
            <div className="body-hub-card-header">
              <div className="body-hub-icon-wrap" aria-hidden="true"><Camera size={20}/></div>
              <div>
                <h3>Photo gallery</h3>
                <p>Private front, side, and back photos.</p>
              </div>
            </div>
            <div className="body-hub-card-footer">
              <Button variant="secondary" onClick={event=>openUpload(undefined,event.currentTarget)}>Add photo set</Button>
              <Button variant="secondary" onClick={openGallery}>Open gallery</Button>
            </div>
          </article>
        </div>
        <div className="body-hub-compare-cta">
          <Button variant="secondary" size="md" onClick={()=>openCompare(0)}><ArrowLeftRight size={16} aria-hidden="true"/>Compare past & present</Button>
        </div>
        {retained>0&&<p className="source body-hub-status">{retained} {retained===1?'change':'changes'} waiting to sync.</p>}
      </section>
      {drafts.map(draft=><PhotoDraftNotice key={draft.versionId??draft.id} draft={draft} store={store}/>)}
      {bodyDrafts.map(draft=><BodyDraftNotice key={draft.mutationId} draft={draft} store={store}/>)}
    </>;
  }

  return <>
    <MotionPanel motionKey={page} axis="fade">
      {view}
    </MotionPanel>
    <PhotoUploadDialog open={uploadOpen} store={store} initial={editingSet} restoreFocus={uploadReturnFocus} onClose={closeUpload} onChanged={()=>void loadPage(true)}/>
    <BodyRecordDialog open={bodyOpen} record={bodyEditor} store={store} restoreFocus={bodyReturnFocus} onClose={closeBodyEditor}/>
  </>;
}

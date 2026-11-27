import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Camera,Scale,ArrowLeftRight,Images,Ruler} from 'lucide-react';
import type {NutritionStore} from '../useNutritionStore';
import type {BodyRecord,PhysiqueAngle} from '../types';
import {backCoordinator} from '../lib/appHistory';
import {allMeasurementKeys,angles,clampIndex} from '../lib/bodyMeasurements';
import {readableDate} from '../lib/format';
import {Button} from './ui/Button';
import {SkeletonBlock} from './ui/Skeleton';
import {EmptyState} from './ui/EmptyState';
import {unitsFor} from '../lib/units';
import {CardFeedback} from './ui/CardFeedback';
import {MotionPanel} from './ui/Motion';
import {BodyCompare} from './BodyCompare';
import {BodyRecordDialog} from './BodyRecordDialog';
import {BodyRecordViewer} from './body/BodyRecordViewer';
import {PhotoSetViewer} from './body/PhotoSetViewer';
import {BodyDraftNotice,BodyHistoryRow,BodyListSkeleton,PhotoDraftNotice,PhotoSetRow} from './body/BodyListRows';
import {useBodyPages} from './body/useBodyPages';
import './body/body.css';

function selectionIndex(records:BodyRecord[],selection:{id:string;index:number}){
  const match=records.findIndex(record=>record.id===selection.id);
  return match<0?clampIndex(selection.index,records.length):match;
}

const measurementTotal=(record:BodyRecord)=>allMeasurementKeys.filter(key=>record.measurements[key]!=null).length;

type BodyView='home'|'history'|'body-viewer'|'gallery'|'viewer'|'compare';
export type BodyRoot='history'|'gallery';

interface PhysiquePhotosProps {
  store:NutritionStore;
  /** Set on the dedicated Body page; the Dashboard hub omits it and shows only the summary card. */
  root?:BodyRoot;
  /** Hub only: asks the app to open the dedicated page. */
  onOpenPage?:(root:BodyRoot)=>void;
  /** Dedicated page only: leaves the Body page for the Dashboard. */
  onExit?:()=>void;
}

// Where Back goes from each inner view; the two roots leave the page instead.
const PARENT_VIEW:Partial<Record<BodyView,BodyView>>={'body-viewer':'history',compare:'history',viewer:'gallery'};

export function PhysiquePhotos({store,root,onOpenPage,onExit}:PhysiquePhotosProps){
  const [page,setPage]=useState<BodyView>(root??'home');
  const history=useBodyPages(page!=='gallery'&&page!=='viewer');
  const gallery=useBodyPages(page==='home'||page==='gallery'||page==='viewer',true);
  const {records:bodyRecords,hasMore:bodyHasMore,loaded:bodyLoaded,error:bodyError,loading:bodyLoading,load:loadBodyPage}=history;
  const {records:sets,hasMore,loaded,error,loading:photoLoading,load:loadPage}=gallery;
  const [editor,setEditor]=useState<{record?:BodyRecord;photoSet:boolean;trigger?:HTMLElement}>();
  const [editorOpen,setEditorOpen]=useState(false);
  const [bodySelection,setBodySelection]=useState({id:'',index:0});
  const [bodyViewerAngle,setBodyViewerAngle]=useState<PhysiqueAngle>('front');
  const [photoSelection,setPhotoSelection]=useState({id:'',index:0});
  const [viewerAngle,setViewerAngle]=useState<PhysiqueAngle>('front');
  const galleryScroll=useRef<number>(undefined);
  const historyScroll=useRef<number>(undefined);

  useEffect(()=>{
    const top=page==='gallery'?galleryScroll.current:page==='history'?historyScroll.current:root?0:undefined;
    if(top==null)return;
    const frame=window.requestAnimationFrame(()=>window.scrollTo({top,behavior:'instant'}));
    return()=>window.cancelAnimationFrame(frame);
  },[page,root]);

  useEffect(()=>{
    if(page==='compare'&&bodyLoaded&&bodyHasMore&&!bodyLoading&&!bodyError)void loadBodyPage(false,100);
  },[page,bodyLoaded,bodyHasMore,bodyLoading,bodyError,loadBodyPage]);

  // Hardware and browser Back step out of an inner view before leaving the page.
  const pageRef=useRef(page);
  pageRef.current=page;
  const backTarget=page==='compare'&&!root?'home':PARENT_VIEW[page];
  const inInnerView=Boolean(backTarget);
  useEffect(()=>{
    if(!inInnerView)return;
    return backCoordinator().register(()=>{const parent=pageRef.current==='compare'&&!root?'home':PARENT_VIEW[pageRef.current];if(parent)setPage(parent);});
  },[inInnerView,root]);

  const bodyIndex=selectionIndex(bodyRecords,bodySelection);
  const viewerIndex=selectionIndex(sets,photoSelection);
  const setBodyIndex=(index:number)=>setBodySelection({id:bodyRecords[index]?.id??'',index});
  const setPhotoIndex=(index:number)=>setPhotoSelection({id:sets[index]?.id??'',index});
  const openEditor=(record:BodyRecord|undefined,photoSet:boolean,trigger?:HTMLElement)=>{
    setEditor({record,photoSet,trigger});setEditorOpen(true);
  };
  const openBodyEditor=(record:BodyRecord|undefined,trigger?:HTMLElement)=>openEditor(record,false,trigger);
  const openUpload=(record:BodyRecord|undefined,trigger:HTMLElement)=>openEditor(record,true,trigger);
  const openViewer=(index=0)=>{
    if(!sets.length)return;
    galleryScroll.current=window.scrollY;
    setPhotoIndex(index);
    setViewerAngle(angles.find(angle=>sets[index].photos.some(photo=>photo.angle===angle&&photo.status==='complete'))??'front');
    setPage('viewer');
  };
  const goOlder=async(photoSet:boolean)=>{
    const items=photoSet?sets:bodyRecords;
    const index=photoSet?viewerIndex:bodyIndex;
    const select=photoSet?setPhotoSelection:setBodySelection;
    const next=items[index+1];
    if(next){select({id:next.id,index:index+1});return;}
    const list=photoSet?gallery:history;
    if(!list.hasMore||list.loading)return;
    const incoming=await list.load();
    const older=incoming.find(record=>!items.some(item=>item.id===record.id));
    if(older)select({id:older.id,index:index+1});
  };
  const openBodyViewer=(index:number)=>{
    historyScroll.current=window.scrollY;setBodyIndex(index);setBodyViewerAngle('front');setPage('body-viewer');
  };
  const openCompare=(index=0)=>{
    if(page==='history')historyScroll.current=window.scrollY;
    setBodyIndex(index);setPage('compare');
  };

  const drafts=store.local?.photoDrafts??[];
  const bodyDrafts=store.local?.bodyDrafts??[];
  const previousRecord=editor?.photoSet?undefined:editor?.record
    ?bodyRecords.find(item=>item.id!==editor.record!.id&&item.date<editor.record!.date)??bodyRecords[bodyRecords.findIndex(item=>item.id===editor.record!.id)+1]
    :bodyRecords[0];
  const weightUnit=unitsFor(store.state!.settings).weight;
  const retained=drafts.length+bodyDrafts.length;
  const back=(label:string,onClick:()=>void)=><Button variant="tertiary" size="sm" className="subpage-back-button" onClick={onClick}><ArrowLeft size={16} aria-hidden="true"/>{label}</Button>;

  // The hub says what is already on file, so it reads as a summary rather than a menu.
  const latestMeasurements=bodyRecords[0]?measurementTotal(bodyRecords[0]):0;
  const latestViews=sets[0]?.photos.filter(photo=>photo.status==='complete').length??0;
  const bodyStatus=bodyError?'Records are unavailable right now.':!bodyLoaded?<><span className="sr-only">Checking your records…</span><SkeletonBlock width="70%" height={11} className="body-hub-status-skeleton"/></>:bodyRecords.length?`Latest record ${readableDate(bodyRecords[0].date)} · ${latestMeasurements} measurement${latestMeasurements===1?'':'s'}`:'No records yet. Measurements, body fat and photos live here.';
  const photoStatus=error?'The gallery is unavailable right now.':!loaded?<><span className="sr-only">Checking your photos…</span><SkeletonBlock width="70%" height={11} className="body-hub-status-skeleton"/></>:sets.length?`Latest set ${readableDate(sets[0].date)} · ${latestViews} of 3 views`:'No photo sets yet. Front, side and back photos stay private.';

  let view: React.ReactNode;
  if(page==='compare'){
    view=<>
      <BodyCompare records={bodyRecords} initialPresentIndex={bodyIndex} initialPastIndex={bodyRecords.length>1?bodyRecords.length-1:0} weightUnit={weightUnit} onBack={()=>setPage(backTarget??'history')} onEditRecord={rec=>openBodyEditor(rec)}/>
      {bodyError&&<CardFeedback title="Some records could not be loaded" message={bodyError} action={{label:'Retry history',onClick:()=>void loadBodyPage(true),disabled:bodyLoading}}/>}
    </>;
  }else if(page==='history'){
    view=<>
      <header className="page-heading photo-view-heading"><div className="subpage-header-title">{back('Back to Dashboard',()=>onExit?.())}<h2>Body history</h2></div><Button variant="primary" onClick={event=>openBodyEditor(undefined,event.currentTarget)}>Add body record</Button></header>
      {bodyError&&<CardFeedback title="Body history unavailable" message={bodyError} action={{label:'Retry history',onClick:()=>void loadBodyPage(true),disabled:bodyLoading}}/>}
      <section className="panel body-history-panel">
        <div className="section-heading"><div><h2>Measurements and photos</h2><p>Newest first.</p></div><Button variant="secondary" disabled={bodyRecords.length<2} onClick={()=>openCompare(0)}><ArrowLeftRight size={16} aria-hidden="true"/>Compare</Button></div>
        {!bodyRecords.length&&!bodyError&&(bodyLoaded?<EmptyState size="card" icon={Ruler} title="No Body records yet" description="Add a record to track measurements, body fat and progress photos over time." action={<Button variant="secondary" onClick={event=>openBodyEditor(undefined,event.currentTarget)}>Add body record</Button>}/>:<BodyListSkeleton kind="history" label="Loading Body history…"/>)}
        <div className="body-history-list">{bodyRecords.map((record,index)=><BodyHistoryRow key={record.id} record={record} weightUnit={weightUnit} onOpen={()=>openBodyViewer(index)} onEdit={trigger=>openBodyEditor(record,trigger)}/>)}</div>
        {bodyHasMore&&<div className="modal-actions"><Button variant="secondary" disabled={bodyLoading} onClick={()=>void loadBodyPage(false)}>{bodyLoading?'Loading…':'Load more'}</Button></div>}
      </section>
      {bodyDrafts.map(draft=><BodyDraftNotice key={draft.mutationId} draft={draft} store={store}/>)}
    </>;
  }else if(page==='body-viewer'){
    const current=bodyRecords[bodyIndex];
    view=<>
      <header className="page-heading photo-view-heading"><div className="subpage-header-title">{back('Back to Body history',()=>setPage('history'))}<h2>Body record</h2></div><div className="physique-hub-actions"><Button variant="secondary" disabled={bodyRecords.length<2} onClick={()=>openCompare(bodyIndex)}><ArrowLeftRight size={16} aria-hidden="true"/>Compare</Button><Button variant="secondary" disabled={!current} onClick={event=>openBodyEditor(current,event.currentTarget)}>Edit record</Button></div></header>
      {bodyError&&<CardFeedback title="Body history unavailable" message={bodyError} action={{label:'Retry history',onClick:()=>void loadBodyPage(true),disabled:bodyLoading}}/>}
      {current?<BodyRecordViewer records={bodyRecords} index={bodyIndex} angle={bodyViewerAngle} weightUnit={weightUnit} onAngle={setBodyViewerAngle} onNewer={()=>setBodyIndex(bodyIndex-1)} onOlder={()=>void goOlder(false)} hasMore={bodyHasMore} busy={bodyLoading}/>:<EmptyState size="card" icon={Ruler} title="No Body records yet" description="Add a record to track measurements, body fat and progress photos over time."/>}
      {bodyDrafts.filter(draft=>draft.id===current?.id).map(draft=><BodyDraftNotice key={draft.mutationId} draft={draft} store={store}/>)}
    </>;
  }else if(page==='gallery'){
    view=<>
      <header className="page-heading photo-view-heading"><div className="subpage-header-title">{back('Back to Dashboard',()=>onExit?.())}<h2>Gallery</h2></div><Button variant="primary" onClick={event=>openUpload(undefined,event.currentTarget)}>Add photo set</Button></header>
      {error&&<CardFeedback title="Photo gallery unavailable" message={error} action={{label:'Retry gallery',onClick:()=>void loadPage(true),disabled:photoLoading}}/>}
      <section className="panel physique-gallery-panel">
        <div className="section-heading"><div><h2>Photo sets</h2><p>Newest first.</p></div><Button variant="secondary" disabled={!sets.length} onClick={()=>openViewer()}><ArrowLeftRight size={16} aria-hidden="true"/>Step through sets</Button></div>
        {!sets.length&&!error&&(loaded?<EmptyState size="card" icon={Images} title="No photo sets yet" description="Front, side and back photos stay private to you." action={<Button variant="secondary" onClick={event=>openUpload(undefined,event.currentTarget)}>Add photo set</Button>}/>:<BodyListSkeleton kind="gallery" label="Loading gallery…"/>)}
        <div className="photo-gallery-list">{sets.map((set,index)=><PhotoSetRow key={set.id} set={set} onEdit={openUpload} onOpen={()=>openViewer(index)}/>)}</div>
        {hasMore&&<div className="modal-actions"><Button variant="secondary" disabled={photoLoading} onClick={()=>void loadPage(false)}>{photoLoading?'Loading…':'Load more'}</Button></div>}
      </section>
      {bodyDrafts.filter(draft=>draft.photoSet||sets.some(set=>set.id===draft.id)).map(draft=><BodyDraftNotice key={draft.mutationId} draft={draft} store={store}/>)}
      {drafts.map(draft=><PhotoDraftNotice key={draft.versionId??draft.id} draft={draft} store={store}/>)}
    </>;
  }else if(page==='viewer'){
    view=<>
      <header className="page-heading photo-view-heading"><div className="subpage-header-title">{back('Back to Gallery',()=>setPage('gallery'))}<h2>Photo sets</h2></div>{sets[viewerIndex]&&<Button variant="secondary" onClick={event=>openUpload(sets[viewerIndex],event.currentTarget)}>Edit photo set</Button>}</header>
      {error&&<CardFeedback title="Photo gallery unavailable" message={error} action={{label:'Retry gallery',onClick:()=>void loadPage(true),disabled:photoLoading}}/>}
      {sets.length?<PhotoSetViewer sets={sets} index={viewerIndex} angle={viewerAngle} hasMore={hasMore} busy={photoLoading} onAngle={setViewerAngle} onOlder={()=>void goOlder(true)} onNewer={()=>setPhotoIndex(viewerIndex-1)}/>:<EmptyState size="card" icon={Images} title="No photo sets yet" description="Add a photo set from the gallery."/>}
      {bodyDrafts.filter(draft=>draft.id===sets[viewerIndex]?.id).map(draft=><BodyDraftNotice key={draft.mutationId} draft={draft} store={store}/>)}
    </>;
  }else{
    view=<>
      <section className="panel physique physique-photo-home">
        <div className="section-heading"><div><h2>Body</h2></div><Button variant="secondary" size="md" disabled={bodyRecords.length<2} title={bodyRecords.length<2?"Comparing needs two body records":undefined} onClick={()=>openCompare(0)}><ArrowLeftRight size={16} aria-hidden="true"/><span className="tab-label-full">Compare past & present</span><span className="tab-label-short">Compare</span></Button></div>
        <div className="body-hub-list">
          <section className="body-hub-row" aria-labelledby="body-hub-records">
            <div className="body-hub-icon-wrap" aria-hidden="true"><Scale size={20}/></div>
            <div className="body-hub-text">
              <h3 id="body-hub-records">Measurements & records</h3>
              <p aria-busy={!bodyLoaded&&!bodyError||undefined}>{bodyStatus}</p>
            </div>
            <div className="body-hub-actions">
              <Button variant="primary" aria-label="Add body record" onClick={event=>openBodyEditor(undefined,event.currentTarget)}><span className="tab-label-full">Add body record</span><span className="tab-label-short">Add record</span></Button>
              <Button variant="secondary" onClick={()=>onOpenPage?.('history')}>Open history</Button>
            </div>
          </section>
          <section className="body-hub-row" aria-labelledby="body-hub-photos">
            <div className="body-hub-icon-wrap" aria-hidden="true"><Camera size={20}/></div>
            <div className="body-hub-text">
              <h3 id="body-hub-photos">Photo gallery</h3>
              <p aria-busy={!loaded&&!error||undefined}>{photoStatus}</p>
            </div>
            <div className="body-hub-actions">
              <Button variant="secondary" onClick={event=>openUpload(undefined,event.currentTarget)}>Add photo set</Button>
              <Button variant="secondary" onClick={()=>onOpenPage?.('gallery')}>Open gallery</Button>
            </div>
          </section>
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
    <BodyRecordDialog open={editorOpen} record={editor?.record} previousRecord={previousRecord} photoSet={editor?.photoSet} store={store} restoreFocus={editor?.trigger} onClose={()=>setEditorOpen(false)}/>
  </>;
}

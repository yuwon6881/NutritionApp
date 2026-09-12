import {Form} from './ui/Form';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Search,ScanBarcode,Sparkles,Plus,Star} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Entry,Food,ScanDraft} from '../types';
import {blankNutrients} from '../types';
import {prepareImage} from '../lib/image';
import {api} from '../lib/api';
import {lineFromPer100,lineKey} from '../lib/foodBasket';
import {serializePortions,parsePortions} from '../lib/portions';
import {Button} from './ui/Button';
import {Field,SelectField,TextArea} from './ui/Field';
import {FileInput} from './ui/FileInput';
import {FoodEditor,type FoodDraft} from './FoodEditor';
import {RecipeEditor} from './RecipeEditor';
import {QuickAdd} from './QuickAdd';
import {FoodPicker} from './FoodPicker';
import {FoodBasket} from './FoodBasket';
import {mealReadOnly,mealTime} from '../lib/foodDiary';
import {useHistoryWindow} from '../useHistoryWindow';
import {useFoodBasket} from '../useFoodBasket';
import {Modal} from './ui/Modal';
import {SegmentedControl} from './ui/SegmentedControl';
import {MotionPanel} from './ui/Motion';
import {useAsyncAction} from './ui/useAsyncAction';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';

type SearchResult=import('../types').FoodSearchResult;
type FoodStep='selection'|'quick'|'editor'|'recipe'|'batch';

export function LogFood({
  open,
  store,
  date,
  editing,
  onClose,
  onSaved,
  initialAi=false,
  initialTime,
  restoreFocus,
}:{
  open:boolean;
  store:Nourish;
  date:string;
  editing?:Entry;
  onClose:()=>void;
  onSaved:()=>void;
  initialAi?:boolean;
  initialTime?:string;
  restoreFocus?:HTMLElement|null;
}){
  const history=useHistoryWindow(store,date);
  const basket=useFoodBasket(open);
  const [step,setStep]=useState<FoodStep>(editing?'editor':'selection');
  const [stepDirty,setStepDirty]=useState(false);
  const [tab,setTab]=useState(initialAi?'ai':'search');
  const [query,setQuery]=useState('');
  const selectionRequest=useRef(0);
  const [detail,setDetail]=useState<{food:SearchResult;error?:string}|null>(null);
  useEffect(()=>{selectionRequest.current++;setDetail(null);return()=>{selectionRequest.current++;};},[open,step,tab,query]);
  const [results,setResults]=useState<SearchResult[]>([]);
  const [draft,setDraft]=useState<Partial<Entry>|undefined>(editing);
  const [saveFood,setSaveFood]=useState<Food|true|false>(false);
  const [description,setDescription]=useState('');
  const [mode,setMode]=useState<ScanDraft['mode']>('description');
  const [photo,setPhoto]=useState<string|null>(null);
  const [activeScanId,setActiveScanId]=useState<string>();
  const [scanDraftId,setScanDraftId]=useState<string>();
  const [scanPickerOpen,setScanPickerOpen]=useState(false);
  const [scanStatusOpen,setScanStatusOpen]=useState(false);
  const [scanBatchAfterClose,setScanBatchAfterClose]=useState(false);
  const [error,setError]=useState('');
  const [batchTime,setBatchTime]=useState<string|undefined>(undefined);
  const {busy,run:runAction}=useAsyncAction();
  const [camera,setCamera]=useState(false);
  const selectionRef=useRef<HTMLDivElement>(null);
  const energyUnit=unitsFor(store.state!.settings).energy;

  const wasOpen=useRef(false);

  useEffect(()=>{
    if(open&&!wasOpen.current){
      setStep(editing?'editor':'selection');
      setStepDirty(false);
      setTab(initialAi?'ai':'search');
      setQuery('');
      setResults([]);
      setDraft(editing);
      setSaveFood(false);
      setDescription('');
      setMode('description');
      setPhoto(null);
       setActiveScanId(undefined);
       setScanDraftId(undefined);
       setScanPickerOpen(false);
       setScanStatusOpen(false);
       setScanBatchAfterClose(false);
      setError('');
      setCamera(false);
      setBatchTime(undefined);
      basket.clear();
    }
    wasOpen.current=open;
  },[open,editing?.id,date,initialAi,basket]);

  useEffect(()=>{if(!open||tab!=='barcode'||step!=='selection')setCamera(false);},[open,tab,step]);

  useLayoutEffect(()=>{
    if(step==='selection')selectionRef.current?.closest<HTMLElement>('.modal-body')?.scrollTo({top:0,left:0,behavior:'auto'});
  },[step,tab]);

  useLayoutEffect(()=>{
    if(!open)return;
    const frame=window.requestAnimationFrame(()=>{
      const target=document.querySelector<HTMLElement>('.food-modal [data-modal-autofocus]');
      if(target?.isConnected)target.focus({preventScroll:true});
    });
    return()=>window.cancelAnimationFrame(frame);
  },[open,step,tab]);

  useEffect(()=>{
    if(!open||tab!=='ai'||!activeScanId)return;
    const scan=store.local?.scans.find(item=>item.id===activeScanId);
    if(!scan)return;
    if(scan.result?.foods.length&&!basket.scanIds.includes(scan.id)){
      basket.addAiFoods(scan.id,scan.result.foods,scan.mode==='label'?'AI label estimate':'AI estimate');
      setDescription('');setPhoto(null);setScanDraftId(undefined);setActiveScanId(undefined);setScanStatusOpen(false);
      if(step==='selection')setScanBatchAfterClose(true);
      return;
    }
    setScanStatusOpen(true);
  },[open,tab,step,activeScanId,store.local?.scans,basket]);

  const persistAiDraft=()=>{
    if(!open||tab!=='ai'||step!=='selection')return;
    const hasInput=mode==='description'?Boolean(description.trim()):Boolean(photo);
    if(!hasInput)return;
    const id=scanDraftId??crypto.randomUUID();
    const existing=scanDraftId?store.local?.scans.find(scan=>scan.id===scanDraftId):undefined;
    // A completed question or failed request is an immutable submitted job.
    // Keep it available so submitScan can create a new id and preserve the
    // original description instead of overwriting the server request hash.
    if(existing?.submitted&& (existing.result||existing.error||existing.jobId))return;
    if(!scanDraftId)setScanDraftId(id);
    void store.saveScanDraft({id,mode,description,imageBase64:mode==='description'?null:photo});
  };
  useEffect(()=>{
    if(!open||tab!=='ai'||step!=='selection')return;
    const hasInput=mode==='description'?Boolean(description.trim()):Boolean(photo);
    if(!hasInput)return;
    const timer=window.setTimeout(persistAiDraft,250);
    return()=>window.clearTimeout(timer);
  },[open,tab,step,mode,description,photo,scanDraftId]);

  const run=async(fn:()=>Promise<void>)=>{setError('');try{await runAction(fn);}catch(ex){setError((ex as Error).message);}};
  const go=(next:FoodStep)=>{if(next==='selection'){setQuery('');setResults([]);setError('');}setStepDirty(false);setStep(next);};
  const selectTab=(next:string)=>{
    setQuery('');setResults([]);setError('');setCamera(false);setTab(next);
    window.requestAnimationFrame(()=>selectionRef.current?.closest<HTMLElement>('.modal-body')?.scrollTo({top:0,left:0,behavior:'auto'}));
  };
  const newTime=()=>initialTime??mealTime(store.state!.profile?.timeZone);
  const close=()=>{
    persistAiDraft();
    if(step!=='selection'&&!editing&&!basket.lines.length){
      go('selection');
      return;
    }
    onClose();
  };
  const log=async(data:FoodDraft)=>{
    if(saveFood){
      await store.mutate({kind:'food',recordId:saveFood===true?crypto.randomUUID():saveFood.id,expectedRevision:saveFood===true?0:saveFood.revision,delete:false,data:{...data,servingGrams:100,favourite:saveFood===true?true:saveFood.favourite,ingredientsJson:saveFood===true?'[]':saveFood.ingredientsJson,cookedYieldGrams:saveFood===true?null:saveFood.cookedYieldGrams}});
      setSaveFood(false);setDraft(undefined);go('selection');
    }else if(editing){
      await store.mutate({kind:'entry',recordId:editing.id,expectedRevision:editing.revision,delete:false,data:{...data,date}});
      onSaved();
    }else{
      if(data.time)setBatchTime(data.time);
      basket.addLine({
        key:`${lineKey(data.name,data.source)}_${crypto.randomUUID().slice(0,8)}`,
        name:data.name,
        calories:data.calories,
        protein:data.protein,
        carbs:data.carbs,
        fat:data.fat,
        fiber:data.fiber,
        source:data.source,
        quantity:data.quantity,
        unit:data.unit,
        portionLabel:data.portionLabel,
        portionGrams:data.portionGrams,
        portions:parsePortions(data.portionsJson),
      });
      go('batch');
    }
  };
  const choose=(food:SearchResult)=>{selectionRequest.current++;setDetail(null);setSaveFood(false);setDraft({...lineFromPer100(food),time:newTime()});go('editor');};
  const chooseSearch=async(food:SearchResult)=>{
    if(tab!=='search'||!food.code||food.portions?.length){choose(food);return;}
    const id=++selectionRequest.current;
    setDetail({food});
    try{
      const resolved=await api<SearchResult>('/foods/barcode/'+encodeURIComponent(food.code));
      if(id===selectionRequest.current)choose(resolved);
    }catch(ex){if(id===selectionRequest.current)setDetail({food,error:(ex as Error).message});}
  };
  const foods=store.state!.foods.filter(food=>!food.deleted&&food.name.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(b.favourite)-Number(a.favourite));
  const recentEntries=store.state!.entries.filter(entry=>!entry.deleted).slice(-8).reverse();
  const selectionDirty=Boolean(basket.lines.length);
  const scanDrafts=(store.local?.scans??[]).filter(scan=>!basket.scanIds.includes(scan.id));
  const activeScan=activeScanId?store.local?.scans.find(scan=>scan.id===activeScanId):undefined;
  const discardScan=async(id:string)=>{
    await store.removeScan(id);
    if(scanPickerOpen)setScanPickerOpen(false);
    if(scanDraftId===id){setScanDraftId(undefined);setDescription('');setPhoto(null);}
    if(activeScanId===id){setActiveScanId(undefined);setScanStatusOpen(false);}
  };
  const resumeScan=(scan:ScanDraft)=>{
    setScanPickerOpen(false);setScanDraftId(scan.id);setMode(scan.mode);setDescription(scan.description);setPhoto(scan.imageBase64);
    if(scan.submitted!==false||scan.result||scan.error){setActiveScanId(scan.id);setScanStatusOpen(true);}
  };
  const submitScan=async()=>{
    const previous=scanDraftId?store.local?.scans.find(scan=>scan.id===scanDraftId):undefined;
    const isAnswer=Boolean(previous?.submitted&&previous.result&&!previous.result.foods.length);
    const id=isAnswer?crypto.randomUUID():(scanDraftId??crypto.randomUUID());
    const submittedDescription=isAnswer&&previous&&description.trim()!==previous.description.trim()
      ?`${previous.description}\nClarification: ${description.trim()}`
      :description;
    setScanDraftId(id);setActiveScanId(id);setScanStatusOpen(true);
    await store.submitScan({id,mode,description:submittedDescription,imageBase64:mode==='description'?null:photo,submitted:true});
  };
  const consumeScan=()=>{
    const scan=activeScan;
    if(!scan?.result?.foods.length)return;
    if(!basket.scanIds.includes(scan.id))basket.addAiFoods(scan.id,scan.result.foods,scan.mode==='label'?'AI label estimate':'AI estimate');
    setDescription('');setPhoto(null);setScanDraftId(undefined);setActiveScanId(undefined);setScanBatchAfterClose(true);setScanStatusOpen(false);
  };
  const title=step==='batch'?`Batch (${basket.lines.length} ${basket.lines.length===1?'food':'foods'})`:step==='selection'?(initialAi?'Scan food or label':'Log food'):step==='quick'?'Quick add':step==='recipe'?'New recipe':editing?'Edit food':saveFood?'Save custom food':'Review food';
  const descriptionText=step==='selection'?`For ${date}`:undefined;

  const selection=<div ref={selectionRef} className="dialog-step food-selection">
    {!editing&&<div className="dialog-toolbar"><Button variant="primary" onClick={()=>go('quick')}><Plus size={17}/>Quick add</Button><Button onClick={()=>{setSaveFood(false);setDraft({...blankNutrients,quantity:1,unit:'serving',time:newTime()});go('editor');}}>Manual entry</Button></div>}
    <SegmentedControl layout="equal" className="section-segments" label="Food logging method" value={tab} options={[
      {value:'search',label:<><Search size={16}/><span>Search</span></>,ariaLabel:'Search'},
      {value:'saved',label:<><Star size={16}/><span className="tab-label-full">Your foods</span><span className="tab-label-short">Saved</span></>,ariaLabel:'Your foods'},
      {value:'barcode',label:<><ScanBarcode size={16}/><span className="tab-label-full">Barcode</span><span className="tab-label-short">Scan</span></>,ariaLabel:'Barcode'},
      {value:'ai',label:<><Sparkles size={16}/><span className="tab-label-full">AI logging</span><span className="tab-label-short">AI</span></>,ariaLabel:'AI logging'}
    ]} onChange={selectTab}/>
    {detail&&<div className="food-detail-status" role="status" aria-busy={!detail.error}>
      <p>{detail.error?`Serving details unavailable for ${detail.food.name}. ${detail.error}`:`Loading serving details for ${detail.food.name}…`}</p>
      <div className="actions">{detail.error&&<Button onClick={()=>void chooseSearch(detail.food)}>Retry serving lookup</Button>}<Button onClick={()=>choose(detail.food)}>Review using 100 g</Button></div>
    </div>}
    {tab==='saved'&&<>
      <div className="section-heading"><div><h3>Your foods</h3><p>Saved foods and recent diary items.</p></div><div className="actions"><Button onClick={()=>{setSaveFood(true);setDraft({...blankNutrients,quantity:100,unit:'g'});go('editor');}}>Custom food</Button><Button onClick={()=>go('recipe')}>New recipe</Button></div></div>
      <Field id="log-food-search" name="query" data-modal-autofocus label="Find your food" value={query} onChange={event=>setQuery(event.target.value)}/>
      {foods.length===0&&<p className="empty">No saved foods yet.</p>}
      {foods.map(food=><div
        className="food-row interactive"
        key={food.id}
        role="button"
        tabIndex={0}
        onClick={()=>choose(food)}
        onKeyDown={event=>{
          if(event.target!==event.currentTarget)return;
          if(event.key==='Enter'||event.key===' '){
            event.preventDefault();
            choose(food);
          }
        }}
      >
        <div className="food-description">
          <strong>{food.name}</strong>
          <small>{displayEnergy(food.calories,energyUnit)} {energyLabel(energyUnit)} / 100 g · {food.source}</small>
        </div>
        <div className="food-row-actions" style={{display:'flex',alignItems:'center',gap:4}}>
          <Button
            variant="tertiary"
            className={`food-row-star ${food.favourite?'starred':''}`}
            aria-label={`${food.favourite?'Unfavourite':'Favourite'} ${food.name}`}
            onClick={event=>{
              event.stopPropagation();
              void runAction(()=>store.mutate({kind:'food',recordId:food.id,expectedRevision:food.revision,delete:false,data:{...food,favourite:!food.favourite}}));
            }}
          >
            <Star size={18} fill={food.favourite?'currentColor':'none'}/>
          </Button>
          <Button
            variant="tertiary"
            aria-label={`Edit ${food.name}`}
            onClick={event=>{
              event.stopPropagation();
              setSaveFood(food);
              setDraft({...food,quantity:100,unit:'g'});
              go('editor');
            }}
          >
            Edit
          </Button>
        </div>
      </div>)}
      <h3>Recent</h3>
      {recentEntries.length>0
        ?<div className="actions">{recentEntries.map(entry=><Button key={entry.id} onClick={()=>{setSaveFood(false);setDraft({...entry,id:undefined});go('editor');}}>{entry.name}</Button>)}</div>
        :<p className="empty recent-empty">No recent diary items yet.</p>}
    </>}
    {(tab==='search'||tab==='barcode')&&<FoodPicker
      tab={tab}
      query={query}
      setQuery={setQuery}
      results={results}
      setResults={setResults}
      busy={busy}
      error={error}
      setError={setError}
      camera={camera}
      setCamera={setCamera}
      basket={basket}
      onChoose={food=>void chooseSearch(food)}
      isSaved={food=>store.state!.foods.some(f=>!f.deleted&&f.name.toLowerCase()===food.name.toLowerCase()&&f.source===food.source&&f.favourite)}
      onToggleSave={food=>void run(async()=>{
        const existing=store.state!.foods.find(f=>!f.deleted&&f.name.toLowerCase()===food.name.toLowerCase()&&f.source===food.source);
        if(existing){
          await store.mutate({kind:'food',recordId:existing.id,expectedRevision:existing.revision,delete:false,data:{...existing,favourite:!existing.favourite}});
        }else{
          await store.mutate({kind:'food',recordId:crypto.randomUUID(),expectedRevision:0,delete:false,data:{...food,portionsJson:serializePortions(food.portions??[]),servingGrams:100,favourite:true,ingredientsJson:'[]',cookedYieldGrams:null}});
        }
      })}
      run={run}
      open={open}
      step={step}
      energyUnit={energyUnit}
    />}
    {tab==='ai'&&<Form onSubmit={()=>void run(submitScan)}>
      <h3>AI logging</h3>
      <SelectField id="ai-log-mode" name="mode" disabled={busy} label="How would you like to log?" value={mode} onChange={value=>{setMode(value as ScanDraft['mode']);setPhoto(null);}}><option value="description">Describe my meal</option><option value="photo">Meal photo</option><option value="label">Nutrition label</option></SelectField>
      <TextArea id="ai-meal-description" name="description" disabled={busy} required={mode==='description'} label="Meal description and portions" maxLength={3000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="150 g coconut rice, one egg, sambal, cucumber, peanuts…"/>
      {mode!=='description'&&<FileInput id="ai-photo-input" name="photo" validate={()=>!photo?'Choose a photo before continuing.':undefined} key={mode} disabled={busy} label={mode==='label'?'Photograph the nutrition label':'Photograph your food'} accept="image/*" capture="environment" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';setPhoto(null);if(file){void run(async()=>setPhoto(await prepareImage(file)));}}}/>}
      {photo&&mode!=='description'&&<p className="notice">Location metadata removed · deleted after processing.</p>}
      <div className="modal-actions"><Button variant="primary" disabled={busy} type="submit"><Sparkles size={18}/>{busy?'Saving estimate…':mode==='label'?'Read nutrition label':'Estimate my meal'}</Button>{scanDrafts.length>0&&<Button type="button" variant="tertiary" size="sm" onClick={()=>setScanPickerOpen(true)}>Resume estimate</Button>}{(description.trim()||photo||scanDraftId)&&<Button type="button" variant="tertiary" size="sm" onClick={()=>void (scanDraftId?discardScan(scanDraftId):(setDescription(''),setPhoto(null)))}>Discard draft</Button>}</div>
    </Form>}
    {error&&<p className="error" role="alert">{error}</p>}
  </div>;

  const child=step==='batch'
    ?<FoodBasket basket={basket} store={store} date={date} onBack={()=>go('selection')} onSaved={onSaved} initialTime={batchTime} onTimeChange={setBatchTime}/>
    :step==='quick'?<QuickAdd store={store} date={date} onDone={onSaved} onDirtyChange={setStepDirty}/>
    :step==='editor'&&draft?<FoodEditor key={JSON.stringify(draft)} initial={draft} title={saveFood?'Save food · per 100 g':editing?'Edit entry':'Review'} energyUnit={energyUnit} onSave={log} onClose={()=>{if(saveFood){setSaveFood(false);setDraft(undefined);go('selection');}else if(editing){onSaved();}else{go('selection');}}} onDirtyChange={setStepDirty}/>
    :step==='recipe'?<RecipeEditor store={store} onClose={()=>go('selection')} onDirtyChange={setStepDirty}/>
    :selection;
  const steps:FoodStep[]=['selection','quick','editor','recipe','batch'];
  const previousStep=useRef(step);
  const stepDirection:1|-1=steps.indexOf(step)>=steps.indexOf(previousStep.current)?1:-1;
  useEffect(()=>{previousStep.current=step;},[step]);
  const animatedChild=<MotionPanel motionKey={step} direction={stepDirection}>{child}</MotionPanel>;

  const content=!history.state?<div className="dialog-step"><p role="status" aria-busy="true">{history.error?'This date is not available on this device. Connect to load its history.':'Loading this diary date…'}</p>{history.error&&<Button onClick={history.retry}>Retry history</Button>}</div>:mealReadOnly(history.state,date)?<div className="dialog-step"><p>Meal detail is available for the latest {history.state.detailDays??90} days. Previously summarized days remain read-only.</p></div>:animatedChild;
  const closeScanStatus=()=>{setScanBatchAfterClose(false);setScanStatusOpen(false);setActiveScanId(undefined);};
  const finishScanStatusClose=()=>{if(scanBatchAfterClose){setScanBatchAfterClose(false);setStep('batch');}};
  return <>
    <Modal open={open} onClose={close} restoreFocus={restoreFocus} title={title} description={descriptionText} headerActions={step==='selection'&&basket.lines.length>0?<Button className="batch-header-button" variant="secondary" aria-label={`View batch, ${basket.lines.length} foods`} onClick={()=>go('batch')}>Batch · {basket.lines.length}</Button>:undefined} dirty={stepDirty||selectionDirty} width="lg" className="food-modal">{content}</Modal>
    <Modal open={scanPickerOpen} onClose={()=>setScanPickerOpen(false)} title="Resume estimate" description="Choose a retained draft or estimate to continue." width="md">
      <div className="scan-draft-list">
        {scanDrafts.map(scan=>{
          const status=scan.submitted===false?'Unfinished draft':scan.result?(scan.result.foods.length?'Ready to review':'Clarification needed'):scan.error?'Needs retry':'Processing';
          return <div className="scan-draft-row" key={scan.id}><div><strong>{scan.mode==='label'?'Nutrition label':scan.mode==='photo'?'Meal photo':'Meal description'}</strong><small>{status}{scan.description?` · ${scan.description}`:''}</small></div><div className="actions"><Button size="sm" onClick={()=>resumeScan(scan)}>{scan.result?.foods.length?'Review estimate':'Resume estimate'}</Button><Button size="sm" variant="tertiary" onClick={()=>void discardScan(scan.id)}>Discard</Button></div></div>;
        })}
      </div>
    </Modal>
    <Modal open={scanStatusOpen&&Boolean(activeScan)} onClose={closeScanStatus} onCloseComplete={finishScanStatusClose} title={activeScan?.result?.foods.length?'Estimate ready':activeScan?.result?'Clarification needed':'Estimating food…'} description="This estimate remains a draft until you review and log the batch." width="md">
      {activeScan?.error&&<div className="scan-status-content"><p className="error" role="alert">{activeScan.error}</p>{activeScan.description&&<p className="source">Original description: {activeScan.description}</p>}<div className="modal-actions"><Button variant="primary" onClick={async()=>{const next=await store.retryScan(activeScan.id);setScanDraftId(next);setActiveScanId(next);setScanStatusOpen(true);}}>Retry estimate</Button><Button variant="destructive" onClick={()=>void discardScan(activeScan.id)}>Discard estimate</Button></div></div>}
      {activeScan&&!activeScan.error&&!activeScan.result&&<div className="scan-status-content"><p role="status" aria-busy="true">{navigator.onLine?'The estimate is being prepared. You can close this window; the retained draft will not interrupt another tab.':'You are offline. The description or image is retained and will resume when you reconnect.'}</p><div className="modal-actions"><Button variant="secondary" onClick={closeScanStatus}>Close</Button></div></div>}
      {activeScan?.result&&!activeScan.result.foods.length&&<div className="scan-status-content"><p className="notice" role="status">No food was added yet. Answer the clarification in the original description, then submit again.</p>{activeScan.result.questions.length>0&&<ul>{activeScan.result.questions.map((question,index)=><li key={index}>{question}</li>)}</ul>}<p className="source">{activeScan.result.explanation}</p><div className="modal-actions"><Button variant="primary" onClick={()=>{setActiveScanId(undefined);setScanStatusOpen(false);setTab('ai');setStep('selection');}}>Edit description</Button><Button variant="destructive" onClick={()=>void discardScan(activeScan.id)}>Discard estimate</Button></div></div>}
      {activeScan?.result?.foods.length&&<div className="scan-status-content"><p role="status">The estimate is ready as editable batch food. No diary entry has been written.</p><div className="modal-actions"><Button variant="primary" onClick={consumeScan}>Review estimate</Button><Button variant="secondary" onClick={closeScanStatus}>Close</Button></div></div>}
    </Modal>
  </>;
}

import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Search,ScanBarcode,Sparkles,Plus,Star,ArrowLeft,ListChecks} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Entry,Food} from '../types';
import {blankNutrients} from '../types';
import {prepareImage} from '../lib/image';
import {api,ApiError} from '../lib/api';
import {foodScanDraftForAttempt,resumeFoodScanJob,type FoodScanDraft} from '../lib/foodScans';
import {barcodeFoodPer100,barcodeValue,foodToSearchResult,labelFoodDraft,parseAiEstimate} from '../lib/logFood';
import {lineFromPer100,lineKey} from '../lib/foodBasket';
import {serializePortions,parsePortions} from '../lib/portions';
import {Button} from './ui/Button';
import {FoodEditor,type FoodDraft} from './FoodEditor';
import {RecipeEditor} from './RecipeEditor';
import {useRecipeDraft} from './useRecipeDraft';
import {QuickAdd} from './QuickAdd';
import {FoodPicker} from './FoodPicker';
import {FoodBasket} from './FoodBasket';
import {mealReadOnly,mealTime} from '../lib/foodDiary';
import {useHistoryWindow} from '../useHistoryWindow';
import {useFoodBasket} from '../useFoodBasket';
import {useBackLayer} from '../lib/useBackLayer';
import {Modal} from './ui/Modal';
import {SegmentedControl} from './ui/SegmentedControl';
import {MotionPanel} from './ui/Motion';
import {useAsyncAction} from './ui/useAsyncAction';
import {unitsFor} from '../lib/units';
import {LogFoodSavedFoods,type SavedFilter} from './LogFoodSavedFoods';
import {LogFoodBarcodeRecovery,type BarcodeRecovery} from './LogFoodBarcodeRecovery';
import {LogFoodAiForm} from './LogFoodAiForm';
import {LogFoodRecents} from './LogFoodRecents';
import {lineFromEntry,rankRecentFoods} from '../lib/recentFoods';
import {today} from '../lib/format';
import {findSavedFood} from '../lib/savedFoods';
import {useFoodScanDraft,type PendingBarcode} from './useFoodScanDraft';

type SearchResult=import('../types').FoodSearchResult;
type FoodStep='selection'|'quick'|'editor'|'recipe'|'batch';
type AiJob={id:string;status:string;resultJson?:string|null;error?:string|null};

export function LogFood({
  open,
  store,
  date,
  editing,
  onClose,
  onSaved,
  initialAi=false,
  initialTab,
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
  initialTab?:'search'|'saved'|'barcode'|'ai';
  initialTime?:string;
  restoreFocus?:HTMLElement|null;
}){
  const defaultTab=initialTab??(initialAi?'ai':'search');
  const history=useHistoryWindow(store,date,open);
  useEffect(()=>{if(open)void store.loadSavedFoods();},[open,store.loadSavedFoods]);
  const basket=useFoodBasket(open,store.state!.id,date);
  const [step,setStep]=useState<FoodStep>(editing?'editor':'selection');
  const [selectionPurpose,setSelectionPurpose]=useState<'log'|'recipe'>('log');
  const recipe=useRecipeDraft();
  const [barcodeRecovery,setBarcodeRecovery]=useState<BarcodeRecovery>();
  const [pendingBarcode,setPendingBarcode]=useState<PendingBarcode>();
  const [pendingLinkBarcode,setPendingLinkBarcode]=useState<PendingBarcode>();
  const [stepDirty,setStepDirty]=useState(false);
  const [tab,setTab]=useState(defaultTab);
  const [query,setQuery]=useState('');
  const [savedFilter,setSavedFilter]=useState<SavedFilter>('all');
  const selectionRequest=useRef(0);
  const [detail,setDetail]=useState<{food:SearchResult;error?:string}|null>(null);
  useEffect(()=>{selectionRequest.current++;setDetail(null);return()=>{selectionRequest.current++;};},[open,step,tab,query]);
  const [results,setResults]=useState<SearchResult[]>([]);
  const [draft,setDraft]=useState<Partial<Entry&Food>|undefined>(editing);
  const [saveFood,setSaveFood]=useState<Food|true|false>(false);
  const [labelNote,setLabelNote]=useState('');
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
      setSelectionPurpose('log');
      recipe.reset();
      setBarcodeRecovery(undefined);
      setPendingBarcode(undefined);
      setPendingLinkBarcode(undefined);
      setStepDirty(false);
      setTab(defaultTab);
      setQuery('');
      setSavedFilter('all');
      setResults([]);
      setDraft(editing);
      setSaveFood(false);
      setLabelNote('');
      setError('');
      setCamera(false);
      setBatchTime(undefined);
    }
    wasOpen.current=open;
  },[open,editing?.id,date,defaultTab,basket]);

  const accountId=store.state!.id;
  const scan=useFoodScanDraft({open,accountId,date,pendingBarcode,onRestore:saved=>{
    setPendingBarcode(saved?.pendingBarcode);
    if(saved)setTab('ai');
  }});
  const {description,setDescription,mode,setMode,photo,setPhoto,scanDraft,scanDraftRef}=scan;
  const persistScanDraft=scan.persist;
  const removeScanDraft=scan.remove;
  const setScanDraftStorageError=scan.setStorageError;

  useEffect(()=>{if(!open||tab!=='barcode'||step!=='selection')setCamera(false);},[open,tab,step]);

  useLayoutEffect(()=>{
    if(step==='selection')selectionRef.current?.closest<HTMLElement>('.modal-body')?.scrollTo({top:0,left:0,behavior:'auto'});
  },[step,tab]);

  useLayoutEffect(()=>{
    if(!open)return;
    const frame=window.requestAnimationFrame(()=>{
      // The outgoing step can still be mounted during its fade, so the batch step names its own target.
      const target=document.querySelector<HTMLElement>(step==='batch'?'.food-modal [data-step-focus]':'.food-modal [data-modal-autofocus],.food-modal [data-validation-focus]');
      if(target?.isConnected)target.focus({preventScroll:true});
    });
    return()=>window.cancelAnimationFrame(frame);
  },[open,step,tab]);

  const run=async(fn:()=>Promise<void>)=>{setError('');try{await runAction(fn);}catch(ex){setError((ex as Error).message);}};
  const toggleFavourite=(food:SearchResult)=>{
    setError('');
    void store.toggleFoodFavourite(food).catch(error=>setError(error instanceof Error?error.message:'Could not change the favourite.'));
  };
  const go=(next:FoodStep)=>{if(next==='selection'){setQuery('');setResults([]);setError('');}setStepDirty(false);setStep(next);};
  const selectTab=(next:'search'|'saved'|'barcode'|'ai')=>{
    setSavedFilter('all');
    setQuery('');setResults([]);setError('');setCamera(false);setTab(next);
    setBarcodeRecovery(undefined);
    if(next!=='saved')setPendingLinkBarcode(undefined);
    if(next!=='ai')setPendingBarcode(undefined);
    window.requestAnimationFrame(()=>selectionRef.current?.closest<HTMLElement>('.modal-body')?.scrollTo({top:0,left:0,behavior:'auto'}));
  };
  const startRecipe=()=>{
    setSelectionPurpose('log');
    recipe.reset();
    setStep('recipe');
  };
  const beginRecipeIngredient=()=>{
    setSelectionPurpose('recipe');
    recipe.clearIngredient();
    selectTab('search');
    setStep('selection');
  };
  const cancelRecipe=()=>{
    setSelectionPurpose('log');
    recipe.reset();
    setTab('saved');
    go('selection');
  };
  const cancelRecipeIngredient=()=>{
    recipe.clearIngredient();
    setStep('recipe');
  };
  const finishRecipe=()=>{
    setSelectionPurpose('log');
    recipe.reset();
    setTab('saved');
    go('selection');
  };
  const recipeDirty=recipe.dirty;
  const newTime=()=>initialTime??mealTime(store.state!.profile?.timeZone);
  // A recent food goes straight to the batch review at its last portion; the review step stays.
  const quickLogRecent=(entry:Entry)=>void run(async()=>{await basket.addLineDurably(lineFromEntry(entry));setBatchTime(newTime());go('batch');});
  const leaveEditor=()=>{if(saveFood){setSaveFood(false);setDraft(undefined);setPendingBarcode(undefined);setLabelNote('');}go('selection');};
  // Back steps out of an inner step before it closes the sheet. A step with
  // unsaved input falls through to the Modal's own discard confirmation.
  const choosingIngredient=step==='selection'&&selectionPurpose==='recipe';
  useBackLayer(open&&!editing&&!stepDirty&&!recipeDirty&&(step!=='selection'||choosingIngredient),()=>{
    if(choosingIngredient)cancelRecipeIngredient();
    else if(step==='recipe')cancelRecipe();
    else if(step==='editor')leaveEditor();
    else go('selection');
  });
  const close=()=>{
    if(step!=='selection'&&!editing&&!basket.lines.length){
      go('selection');
      return;
    }
    onClose();
  };
  const submitAiEstimate=async()=>{
    if(!scan.ready)throw new Error('Checking saved scan work on this device. Try again in a moment.');
    if(mode!=='description'&&!photo)throw new Error('Choose a photo before continuing.');
    const input={date,mode,description,imageBase64:mode==='description'?null:photo,pendingBarcode:pendingBarcode?{...pendingBarcode}:undefined};
    const base=foodScanDraftForAttempt(scanDraftRef.current,input);
    const useSavedReview=base.status==='review'&&!!base.resultJson;
    const requestDraft:FoodScanDraft=useSavedReview?base:{...base,...input,status:'submitted',error:null};
    await persistScanDraft(requestDraft);
    let job:AiJob;
    try{
      if(useSavedReview)job={id:requestDraft.id,status:'complete',resultJson:requestDraft.resultJson};
      else job=await resumeFoodScanJob(requestDraft);
    }catch(ex){
      const message=ex instanceof Error?ex.message:'AI could not estimate this meal. Try again.';
      await persistScanDraft({...requestDraft,status:'submitted',error:message}).catch(()=>undefined);
      throw ex;
    }
    if(job.status!=='complete'||!job.resultJson){
      const message=job.error??'AI could not estimate this meal. Try again.';
      await persistScanDraft({...requestDraft,status:job.status==='failed'?'failed':'submitted',error:message});
      throw new Error(message);
    }
    const estimate=parseAiEstimate(job.resultJson);
    const barcodeContext=pendingBarcode;
    if(!Array.isArray(estimate.foods)||estimate.foods.length===0){
      if(barcodeContext&&mode==='label')throw new Error('The nutrition label must identify exactly one product. Retake the label photo and try again.');
      throw new Error(estimate.explanation||'AI could not identify a food. Add more detail and try again.');
    }
    await persistScanDraft({...requestDraft,status:'review',imageBase64:null,resultJson:job.resultJson,error:null});
    if(barcodeContext&&mode==='label'){
      if(estimate.foods.length!==1)throw new Error('The nutrition label must identify exactly one product. Retake the label photo and try again.');
      const food=estimate.foods[0];
      setLabelNote(food.notes||'');
      setSaveFood(true);
      setDraft(labelFoodDraft(food,barcodeContext.code));
      setDescription('');setPhoto(null);go('editor');
      return;
    }
    await basket.addAiFoods(estimate.foods,mode==='label'?'AI label estimate':'AI estimate',requestDraft.id);
    await removeScanDraft(date);
    setDescription('');setPhoto(null);setLabelNote('');go('batch');
  };
  const log=async(data:FoodDraft)=>{
    if(saveFood){
      const barcodeContext=pendingBarcode;
      let savedData:FoodDraft={...data,barcode:data.barcode?.trim()||null};
      if(barcodeContext)savedData=barcodeFoodPer100(data,barcodeContext.code);
      const scanFoodId=saveFood===true&&scanDraftRef.current?.status==='review'?scanDraftRef.current.id:null;
      const foodId=saveFood===true?(scanFoodId??crypto.randomUUID()):saveFood.id;
      const alreadySaved=!!scanFoodId&&store.state!.foods.some(food=>food.id===scanFoodId&&!food.deleted);
      if(!alreadySaved)await store.mutate({kind:'food',recordId:foodId,expectedRevision:saveFood===true?0:saveFood.revision,delete:false,data:{...savedData,servingGrams:100,favourite:saveFood===true?true:saveFood.favourite,ingredientsJson:saveFood===true?'[]':saveFood.ingredientsJson,cookedYieldGrams:saveFood===true?null:saveFood.cookedYieldGrams}});
      if(scanFoodId)await removeScanDraft(date).catch(()=>setScanDraftStorageError('The reviewed scan is still saved on this device. It can be safely cleared after this food finishes saving.'));
      setSaveFood(false);setDraft(undefined);
      setLabelNote('');
      if(barcodeContext){
        setPendingBarcode(undefined);
        const result:SearchResult={
          name:savedData.name,
          calories:savedData.calories,
          protein:savedData.protein,
          fat:savedData.fat,
          carbs:savedData.carbs,
          fiber:savedData.fiber,
          source:savedData.source,
          servingGrams:100,
          portions:parsePortions(savedData.portionsJson),
          code:savedData.barcode??barcodeContext.code,
          basis:'per100g',
        };
        if(barcodeContext.purpose==='recipe'){
          setSelectionPurpose('recipe');
          chooseRecipe(result);
        }else{
          setSelectionPurpose('log');
          setDraft({...lineFromPer100(result),time:newTime()});
          setStep('editor');
        }
      }else go('selection');
    }else if(editing){
      await store.mutate({kind:'entry',recordId:editing.id,expectedRevision:editing.revision,delete:false,data:{...data,date}});
      onSaved();
    }else{
      if(data.time)setBatchTime(data.time);
      await basket.addLineDurably({
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
  const resolveBarcode=async(code:string):Promise<SearchResult>=>{
    const normalized=code.trim();
    const local=store.state!.foods.find(food=>!food.deleted&&food.barcode?.trim()===normalized);
    if(local)return foodToSearchResult(local);
    return api<SearchResult>('/foods/barcode/'+encodeURIComponent(normalized));
  };
  const retryBarcode=()=>{
    const recovery=barcodeRecovery;
    if(!recovery)return;
    setBarcodeRecovery(undefined);
    setResults([]);
    setQuery(recovery.code);
    void run(async()=>{
      try{
        setResults([await resolveBarcode(recovery.code)]);
      }catch(ex){
        const problem=ex instanceof ApiError?ex:new ApiError('Barcode lookup unavailable. Scan the label or enter this food manually.',503);
        if([404,422,429,503].includes(problem.status)){setBarcodeRecovery({code:recovery.code,status:problem.status,message:problem.message});return;}
        throw ex;
      }
    });
  };
  const choose=(food:SearchResult)=>{selectionRequest.current++;setDetail(null);setBarcodeRecovery(undefined);setSaveFood(false);setDraft({...lineFromPer100(food),time:newTime()});go('editor');};
  const chooseRecipe=(food:SearchResult)=>{
    setDetail(null);
    setBarcodeRecovery(undefined);
    recipe.pickIngredient(food);
    setStep('recipe');
  };
  const chooseForPurpose=(food:SearchResult)=>selectionPurpose==='recipe'?chooseRecipe(food):choose(food);
  const chooseSearch=async(food:SearchResult)=>{
    const code=barcodeValue(food.code);
    if(tab!=='search'||!code||food.portions?.length){chooseForPurpose(food);return;}
    const id=++selectionRequest.current;
    setDetail({food});
    try{
      const resolved=await resolveBarcode(code);
      if(id===selectionRequest.current)chooseForPurpose(resolved);
    }catch(ex){if(id===selectionRequest.current)setDetail({food,error:(ex as Error).message});}
  };
  const allSavedFoods=store.state!.foods.filter(food=>!food.deleted);
  const zone=store.state!.profile?.timeZone;
  const [nowHours,nowMinutes]=mealTime(zone).split(':').map(Number);
  const recentEntries=rankRecentFoods(store.state!.entries,{date:today(zone),minutes:nowHours*60+nowMinutes});
  const beginBarcodeLink=()=>{
    if(!barcodeRecovery)return;
    setPendingLinkBarcode({code:barcodeRecovery.code,purpose:selectionPurpose});
    setBarcodeRecovery(undefined);
    selectTab('saved');
  };
  const beginBarcodeLabel=()=>{
    if(!barcodeRecovery)return;
    setPendingBarcode({code:barcodeRecovery.code,purpose:selectionPurpose});
    setMode('label');setDescription('');setPhoto(null);setError('');setTab(selectionPurpose==='recipe'?'barcode':'ai');
  };
  const beginBarcodeManual=()=>{
    if(!barcodeRecovery)return;
    setPendingBarcode({code:barcodeRecovery.code,purpose:selectionPurpose});
    setLabelNote('');setSaveFood(true);setDraft({...blankNutrients,name:`Packaged food ${barcodeRecovery.code}`,quantity:100,unit:'g',barcode:barcodeRecovery.code});
    setBarcodeRecovery(undefined);go('editor');
  };
  const chooseSaved=(food:Food)=>{
    const link=pendingLinkBarcode;
    if(!link){chooseForPurpose(foodToSearchResult(food));return;}
    void run(async()=>{
      await store.mutate({kind:'food',recordId:food.id,expectedRevision:food.revision,delete:false,data:{...food,barcode:link.code}});
      setPendingLinkBarcode(undefined);setBarcodeRecovery(undefined);
      const linked=foodToSearchResult({...food,barcode:link.code});
      if(link.purpose==='recipe'){
        setSelectionPurpose('recipe');
        chooseRecipe(linked);
      }else{
        setSelectionPurpose('log');
        choose(linked);
      }
    });
  };
  const selectionDirty=Boolean(basket.lines.length);
  const title=step==='batch'?`Batch (${basket.lines.length} ${basket.lines.length===1?'food':'foods'})`:step==='selection'?(selectionPurpose==='recipe'?'Choose ingredient':initialAi?'Scan food or label':'Log food'):step==='quick'?'Quick add':step==='recipe'?'New recipe':editing?'Edit food':saveFood?'Save custom food':'Review food';
  const descriptionText=step==='selection'?`For ${date}`:undefined;
  const hasSavedScanReview=scan.hasSavedReview;

  const selection=<div ref={selectionRef} className="dialog-step food-selection">
    {selectionPurpose==='recipe'&&<div className="editor-back-nav"><Button type="button" variant="tertiary" size="sm" className="subpage-back-button" onClick={cancelRecipeIngredient}><ArrowLeft size={16} aria-hidden="true"/>Back to recipe</Button></div>}
    {selectionPurpose==='log'&&!editing&&<div className="dialog-toolbar"><Button variant="primary" onClick={()=>go('quick')}><Plus size={17}/>Quick add</Button><Button onClick={()=>{setSaveFood(false);setDraft({...blankNutrients,quantity:1,unit:'serving',time:newTime()});go('editor');}}>Manual entry</Button></div>}
    <SegmentedControl<'search'|'saved'|'barcode'|'ai'> layout="equal" className="section-segments" label="Food logging method" value={tab} options={[
      {value:'search',label:<><Search size={16}/><span>Search</span></>,ariaLabel:'Search'},
      {value:'saved',label:<><Star size={16}/><span className="tab-label-full">Your foods</span><span className="tab-label-short">Saved</span></>,ariaLabel:'Your foods'},
      {value:'barcode',label:<><ScanBarcode size={16}/><span className="tab-label-full">Barcode</span><span className="tab-label-short">Scan</span></>,ariaLabel:'Barcode'},
      ...(selectionPurpose==='log'?[{value:'ai' as const,label:<><Sparkles size={16}/><span className="tab-label-full">AI logging</span><span className="tab-label-short">AI</span></>,ariaLabel:'AI logging'}]:[]),
    ]} onChange={selectTab}/>
    {detail&&<div className="food-detail-status" role="status" aria-busy={!detail.error}>
      <p>{detail.error?`Serving details unavailable for ${detail.food.name}. ${detail.error}`:`Loading serving details for ${detail.food.name}…`}</p>
      <div className="actions">{detail.error&&<Button onClick={()=>void chooseSearch(detail.food)}>Retry serving lookup</Button>}<Button onClick={()=>chooseForPurpose(detail.food)}>Review using 100 g</Button></div>
    </div>}
    {tab==='saved'&&<LogFoodSavedFoods
      purpose={selectionPurpose}
      linkBarcode={pendingLinkBarcode?.code}
      onCancelLink={()=>{setPendingLinkBarcode(undefined);setTab('barcode');}}
      query={query}
      onQueryChange={setQuery}
      filter={savedFilter}
      onFilterChange={setSavedFilter}
      savedFoods={allSavedFoods}
      recentEntries={recentEntries}
      energyUnit={energyUnit}
      onPickRecent={quickLogRecent}
      onChoose={chooseSaved}
      onToggleFavourite={food=>toggleFavourite(foodToSearchResult(food))}
      onEdit={food=>{setSaveFood(food);setDraft({...food,quantity:100,unit:'g'});go('editor');}}
      onCustomFood={()=>{setSaveFood(true);setDraft({...blankNutrients,quantity:100,unit:'g'});go('editor');}}
      onNewRecipe={startRecipe}
    />}
    {(tab==='search'||tab==='barcode')&&!pendingBarcode&&<FoodPicker
      tab={tab}
      searchLabel={selectionPurpose==='recipe'?'Search ingredients':'Search term'}
      query={query}
      setQuery={setQuery}
      results={results}
      setResults={setResults}
      busy={busy}
      error={error}
      setError={setError}
      camera={camera}
      setCamera={setCamera}
      onChoose={food=>void chooseSearch(food)}
      lookup={async(kind,value)=>kind==='barcode'?resolveBarcode(value):api<SearchResult[]>('/foods/search?q='+encodeURIComponent(value))}
      onBarcodeError={(code,problem)=>{setResults([]);setBarcodeRecovery({code,status:problem.status,message:problem.message});}}
      isSaved={food=>findSavedFood(store.state!.foods,food)?.favourite===true}
      onToggleSave={toggleFavourite}
      run={run}
      open={open}
      step={step}
      energyUnit={energyUnit}
    />}
    {tab==='search'&&selectionPurpose==='log'&&!pendingBarcode&&!query.trim()&&!results.length&&<LogFoodRecents entries={recentEntries} energyUnit={energyUnit} onPick={quickLogRecent}/>}
    {tab==='barcode'&&!pendingBarcode&&barcodeRecovery&&<LogFoodBarcodeRecovery recovery={barcodeRecovery} onRetry={retryBarcode} onLink={beginBarcodeLink} onLabel={beginBarcodeLabel} onManual={beginBarcodeManual}/>}
    {(tab==='ai'||pendingBarcode)&&<LogFoodAiForm
      date={date}
      busy={busy}
      pendingBarcode={pendingBarcode}
      mode={mode}
      onModeChange={value=>{setMode(value);setPhoto(null);}}
      description={description}
      onDescriptionChange={setDescription}
      photo={photo}
      onPhotoFile={file=>void run(async()=>{await scan.attachPhoto(await prepareImage(file));})}
      hasSavedReview={hasSavedScanReview}
      scanDraft={scanDraft}
      storageError={scan.storageError}
      onSubmit={()=>void run(submitAiEstimate)}
      onBackToBarcode={()=>{setPendingBarcode(undefined);setTab('barcode');}}
    />}
    {error&&<p className="error" role="alert">{error}</p>}
  </div>;

  const child=step==='batch'
    ?<FoodBasket basket={basket} store={store} date={date} onBack={()=>{if(tab==='ai'){go('selection');}else{selectTab('search');go('selection');}}} onSaved={onSaved} initialTime={batchTime} onTimeChange={setBatchTime} onScanAnother={tab==='barcode'?()=>{selectTab('barcode');go('selection');setCamera(true);}:undefined}/>
    :step==='quick'?<QuickAdd store={store} date={date} onDone={onSaved} onBack={()=>go('selection')} onDirtyChange={setStepDirty}/>
    :step==='editor'&&draft?<FoodEditor key={JSON.stringify(draft)} initial={draft} title={saveFood?'Save food · per 100 g':editing?'Edit entry':'Review'} labelNote={labelNote} energyUnit={energyUnit} onSave={log} onClose={()=>{if(editing)onClose();else leaveEditor();}} onDirtyChange={setStepDirty}/>
    :step==='recipe'?<RecipeEditor
      store={store}
      draft={recipe.draft}
      onDraftChange={recipe.setDraft}
      selected={recipe.selected}
      quantity={recipe.quantity}
      onQuantityChange={recipe.setQuantity}
      onAddIngredient={recipe.addIngredient}
      onBeginIngredient={beginRecipeIngredient}
      onCancelIngredient={cancelRecipeIngredient}
      onClose={cancelRecipe}
      onSaved={finishRecipe}
    />
    :selection;
  const steps:FoodStep[]=['selection','quick','editor','recipe','batch'];
  const previousStep=useRef(step);
  const stepDirection:1|-1=steps.indexOf(step)>=steps.indexOf(previousStep.current)?1:-1;
  useEffect(()=>{previousStep.current=step;},[step]);
  const animatedChild=<MotionPanel motionKey={step} direction={stepDirection} axis="fade">{child}</MotionPanel>;

  const content=!history.state?<div className="dialog-step"><p role="status" aria-busy="true">{history.error?'This date is not available on this device. Connect to load its history.':'Loading this diary date…'}</p>{history.error&&<Button onClick={history.retry}>Retry history</Button>}</div>:mealReadOnly(history.state,date)?<div className="dialog-step"><p>Meal detail is available for the latest {history.state.detailDays??90} days. Previously summarized days remain read-only.</p></div>:animatedChild;
  const readyContent=!basket.ready?<div className="dialog-step"><p role="status" aria-busy="true">Restoring your unfinished food batch…</p></div>:basket.storageError?<div className="dialog-step"><p className="notice" role="alert">{basket.storageError}</p><Button variant="secondary" onClick={()=>void basket.retrySave().catch(()=>{})}>Retry saving this batch</Button>{animatedChild}</div>:animatedChild;
  const resolvedContent=history.state&& !mealReadOnly(history.state,date) ? readyContent : content;
  return <>
    <Modal open={open} onClose={close} restoreFocus={restoreFocus} title={title} description={descriptionText} headerActions={step==='selection'&&basket.lines.length>0?<Button className="batch-header-button" variant="secondary" aria-label={`View batch, ${basket.lines.length} foods`} onClick={()=>go('batch')}><ListChecks size={16} aria-hidden="true"/><span>Batch</span><span className="batch-header-separator" aria-hidden="true">·</span><span className="batch-header-count">{basket.lines.length}</span></Button>:undefined} dirty={stepDirty||selectionDirty||recipeDirty} width="lg" className="food-modal">{resolvedContent}</Modal>
  </>;
}

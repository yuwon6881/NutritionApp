import {Form} from './ui/Form';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Search,ScanBarcode,Sparkles,Plus,Star} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {AiEstimate,Entry,Food} from '../types';
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
type AiMode='photo'|'label'|'description';
type AiJob={id:string;status:string;resultJson?:string|null;error?:string|null};

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
  const [mode,setMode]=useState<AiMode>('description');
  const [photo,setPhoto]=useState<string|null>(null);
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

  const run=async(fn:()=>Promise<void>)=>{setError('');try{await runAction(fn);}catch(ex){setError((ex as Error).message);}};
  const go=(next:FoodStep)=>{if(next==='selection'){setQuery('');setResults([]);setError('');}setStepDirty(false);setStep(next);};
  const selectTab=(next:string)=>{
    setQuery('');setResults([]);setError('');setCamera(false);setTab(next);
    window.requestAnimationFrame(()=>selectionRef.current?.closest<HTMLElement>('.modal-body')?.scrollTo({top:0,left:0,behavior:'auto'}));
  };
  const newTime=()=>initialTime??mealTime(store.state!.profile?.timeZone);
  const close=()=>{
    if(step!=='selection'&&!editing&&!basket.lines.length){
      go('selection');
      return;
    }
    onClose();
  };
  const submitAiEstimate=async()=>{
    const id=crypto.randomUUID();
    let job=await api<AiJob>('/scans',{
      id,
      mode,
      description:mode==='description'?description:'',
      imageBase64:mode==='description'?null:photo,
    });
    if(job.status==='queued'||job.status==='processing')job=await api<AiJob>('/scans/'+job.id+'/process',{});
    if(job.status!=='complete'||!job.resultJson)throw new Error(job.error??'AI could not estimate this meal. Try again.');
    let estimate:AiEstimate;
    try{estimate=JSON.parse(job.resultJson) as AiEstimate;}catch{throw new Error('AI returned an invalid estimate. Try again.');}
    if(!Array.isArray(estimate.foods)||estimate.foods.length===0)throw new Error(estimate.explanation||'AI could not identify a food. Add more detail and try again.');
    basket.addAiFoods(estimate.foods,mode==='label'?'AI label estimate':'AI estimate');
    setDescription('');setPhoto(null);go('batch');
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
    {tab==='ai'&&<Form onSubmit={()=>void run(submitAiEstimate)} className="ai-logging-form">
      <h3>AI logging</h3>
      <SelectField id="ai-log-mode" name="mode" disabled={busy} label="How would you like to log?" value={mode} onChange={value=>{setMode(value as AiMode);setPhoto(null);}}><option value="description">Describe my meal</option><option value="photo">Meal photo</option><option value="label">Nutrition label</option></SelectField>
      <TextArea id="ai-meal-description" name="description" disabled={busy} required={mode==='description'} label="Meal description and portions" maxLength={3000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="150 g coconut rice, one egg, sambal, cucumber, peanuts…"/>
      {mode!=='description'&&<FileInput id="ai-photo-input" name="photo" validate={()=>!photo?'Choose a photo before continuing.':undefined} key={mode} disabled={busy} label={mode==='label'?'Photograph the nutrition label':'Photograph your food'} accept="image/*" capture="environment" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';setPhoto(null);if(file){void run(async()=>setPhoto(await prepareImage(file)));}}}/>}
      {photo&&mode!=='description'&&<p className="notice">Location metadata removed · deleted after processing.</p>}
      <div className="modal-actions"><Button variant="primary" disabled={busy} type="submit"><Sparkles size={18}/>{busy?'Estimating…':mode==='label'?'Read nutrition label':'Estimate my meal'}</Button></div>
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
  return <>
    <Modal open={open} onClose={close} restoreFocus={restoreFocus} title={title} description={descriptionText} headerActions={step==='selection'&&basket.lines.length>0?<Button className="batch-header-button" variant="secondary" aria-label={`View batch, ${basket.lines.length} foods`} onClick={()=>go('batch')}>Batch · {basket.lines.length}</Button>:undefined} dirty={stepDirty||selectionDirty} width="lg" className="food-modal">{content}</Modal>
  </>;
}

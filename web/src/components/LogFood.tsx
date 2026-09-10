import {Form} from './ui/Form';
import {useEffect,useRef,useState} from 'react';
import {Search,ScanBarcode,Sparkles,Plus,Star} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Entry,Food,Nutrients,ScanDraft} from '../types';
import {blankNutrients} from '../types';
import {prepareImage} from '../lib/image';
import {lineKey} from '../lib/foodBasket';
import {Button} from './ui/Button';
import {Field,SelectField,TextArea} from './ui/Field';
import {FileInput} from './ui/FileInput';
import {FoodEditor,type FoodDraft} from './FoodEditor';
import {RecipeEditor} from './RecipeEditor';
import {ScanReview} from './ScanReview';
import {QuickAdd} from './QuickAdd';
import {FoodPicker} from './FoodPicker';
import {FoodBasket} from './FoodBasket';
import {Checkbox} from './ui/Checkbox';
import {mealReadOnly,mealTime} from '../lib/foodDiary';
import {useHistoryWindow} from '../useHistoryWindow';
import {useFoodBasket} from '../useFoodBasket';
import {Modal} from './ui/Modal';
import {SegmentedControl} from './ui/SegmentedControl';
import {MotionPanel} from './ui/Motion';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';

type SearchResult=Nutrients&{servingGrams:number};
type FoodStep='selection'|'quick'|'editor'|'recipe'|'scan'|'batch';

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
  const [tab,setTab]=useState(initialAi?'ai':'saved');
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<SearchResult[]>([]);
  const [draft,setDraft]=useState<Partial<Entry>|undefined>(editing);
  const [saveFood,setSaveFood]=useState<Food|true|false>(false);
  const [description,setDescription]=useState('');
  const [mode,setMode]=useState<ScanDraft['mode']>('description');
  const [photo,setPhoto]=useState<string|null>(null);
  const [activeScanId,setActiveScanId]=useState<string>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [camera,setCamera]=useState(false);
  const energyUnit=unitsFor(store.state!.settings).energy;

  const wasOpen=useRef(false);

  useEffect(()=>{
    if(open&&!wasOpen.current){
      setStep(editing?'editor':'selection');
      setStepDirty(false);
      setTab(initialAi?'ai':'saved');
      setQuery('');
      setResults([]);
      setDraft(editing);
      setSaveFood(false);
      setDescription('');
      setMode('description');
      setPhoto(null);
      setActiveScanId(undefined);
      setError('');
      setCamera(false);
      basket.clear();
    }
    wasOpen.current=open;
  },[open,editing?.id,date,initialAi,basket]);

  useEffect(()=>{if(!open||tab!=='barcode'||step!=='selection')setCamera(false);},[open,tab,step]);

  useEffect(()=>{
    if(step!=='selection'||!activeScanId)return;
    const scan=store.local?.scans.find(item=>item.id===activeScanId);
    if(scan?.result)setStep('scan');
  },[step,activeScanId,store.local?.scans]);

  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(ex){setError((ex as Error).message);}finally{setBusy(false);}};
  const go=(next:FoodStep)=>{setStepDirty(false);setStep(next);};
  const newTime=()=>initialTime??mealTime(store.state!.profile?.timeZone);
  const close=()=>{
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
    }else{
      await store.mutate({kind:'entry',recordId:editing?.id??crypto.randomUUID(),expectedRevision:editing?.revision??0,delete:false,data:{...data,date}});
      onSaved();
    }
  };
  const choose=(food:SearchResult)=>{setSaveFood(false);setDraft({...food,quantity:100,unit:'g',time:newTime()});go('editor');};
  const foods=store.state!.foods.filter(food=>!food.deleted&&food.name.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(b.favourite)-Number(a.favourite));
  const selectionDirty=(step==='selection'&&tab==='ai'&&(Boolean(description.trim())||Boolean(photo)))||Boolean(basket.lines.length);
  const scanDrafts=store.local?.scans??[];
  const title=step==='batch'?`Batch (${basket.lines.length} ${basket.lines.length===1?'food':'foods'})`:step==='selection'?(initialAi?'Scan food or label':'Log food'):step==='quick'?'Quick add':step==='recipe'?'New recipe':step==='scan'?'Review scan':editing?'Edit food':saveFood?'Save custom food':'Review food';
  const descriptionText=step==='selection'?`For ${date}`:step==='scan'?'Review the estimate before adding it to your diary.':undefined;

  const selection=<div className="dialog-step food-selection">
    {!editing&&<div className="dialog-toolbar"><Button variant="primary" onClick={()=>go('quick')}><Plus size={17}/>Quick add</Button><Button onClick={()=>{setSaveFood(false);setDraft({...blankNutrients,quantity:1,unit:'serving',time:newTime()});go('editor');}}>Manual entry</Button></div>}
    <SegmentedControl layout="equal" className="section-segments" label="Food logging method" value={tab} onChange={setTab} options={[
      {value:'saved',label:<><Star size={17}/>Your foods</>},{value:'search',label:<><Search size={17}/>Search</>},
      {value:'barcode',label:<><ScanBarcode size={17}/>Barcode</>},{value:'ai',label:<><Sparkles size={17}/>AI logging</>}
    ]}/>
    {basket.lines.length>0&&<div className="notice" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:12,marginBottom:18}}>
      <span><strong>{basket.lines.length} {basket.lines.length===1?'food':'foods'} in batch</strong></span>
      <Button variant="primary" size="sm" onClick={()=>go('batch')}>Review batch</Button>
    </div>}
    {tab==='saved'&&<>
      <div className="section-heading"><div><h3>Your foods</h3><p>Saved foods and recent diary items.</p></div><div className="actions"><Button onClick={()=>{setSaveFood(true);setDraft({...blankNutrients,quantity:100,unit:'g'});go('editor');}}>Custom food</Button><Button onClick={()=>go('recipe')}>New recipe</Button></div></div>
      <Field id="log-food-search" name="query" data-modal-autofocus label="Find your food" value={query} onChange={event=>setQuery(event.target.value)}/>
      {foods.length===0&&<p className="empty">No saved foods yet.</p>}
      {foods.map(food=><div className="food-row" key={food.id}>
        <Checkbox
          checked={basket.lines.some(l=>l.key===lineKey(food.name,food.source))}
          aria-label={`Select ${food.name} for batch logging`}
          onChange={()=>basket.toggleItem(food)}
        />
        <div className="food-description"><Button variant="tertiary" onClick={()=>choose(food)}>{food.name}</Button><small>{displayEnergy(food.calories,energyUnit)} {energyLabel(energyUnit)} / 100 g · {food.source}</small></div>
        <Button variant="tertiary" aria-label={`${food.favourite?'Unfavourite':'Favourite'} ${food.name}`} onClick={()=>void run(()=>store.mutate({kind:'food',recordId:food.id,expectedRevision:food.revision,delete:false,data:{...food,favourite:!food.favourite}}))}><Star size={18} fill={food.favourite?'currentColor':'none'}/></Button>
        <Button onClick={()=>{setSaveFood(food);setDraft({...food,quantity:100,unit:'g'});go('editor');}}>Edit</Button>
      </div>)}
      <h3>Recent</h3><div className="actions">{store.state!.entries.filter(entry=>!entry.deleted).slice(-8).reverse().map(entry=><Button key={entry.id} onClick={()=>{setSaveFood(false);setDraft({...entry,id:undefined});go('editor');}}>{entry.name}</Button>)}</div>
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
      onChoose={choose}
      onSaveFood={food=>{setSaveFood(true);setDraft({...food,quantity:100,unit:'g'});go('editor');}}
      run={run}
      open={open}
      step={step}
      energyUnit={energyUnit}
    />}
    {tab==='ai'&&<Form onSubmit={()=>void run(async()=>{const id=crypto.randomUUID();setActiveScanId(id);await store.addScan({id,mode,description,imageBase64:mode==='description'?null:photo});setDescription('');setPhoto(null);})}>
      <h3>AI logging</h3>
      <SelectField id="ai-log-mode" name="mode" disabled={busy} label="How would you like to log?" value={mode} onChange={value=>{setMode(value as ScanDraft['mode']);setPhoto(null);}}><option value="description">Describe my meal</option><option value="photo">Meal photo</option><option value="label">Nutrition label</option></SelectField>
      <TextArea id="ai-meal-description" name="description" required={mode==='description'} label="Meal description and portions" maxLength={3000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="150 g coconut rice, one egg, sambal, cucumber, peanuts…"/>
      {mode!=='description'&&<FileInput id="ai-photo-input" name="photo" validate={()=>!photo?'Choose a photo before continuing.':undefined} key={mode} disabled={busy} label={mode==='label'?'Photograph the nutrition label':'Photograph your food'} accept="image/*" capture="environment" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';setPhoto(null);if(file){void run(async()=>setPhoto(await prepareImage(file)));}}}/>}
      {photo&&mode!=='description'&&<p className="notice">Location metadata removed · deleted after processing.</p>}
      <div className="modal-actions"><Button variant="primary" disabled={busy} type="submit"><Sparkles size={18}/>{mode==='label'?'Read nutrition label':'Estimate my meal'}</Button></div>
    </Form>}
    {error&&<p className="error" role="alert">{error}</p>}
    {scanDrafts.length>0&&<div className="scan-drafts"><h3>Saved scans</h3>{scanDrafts.map(scan=>scan.result?<div className="notice" key={scan.id}><p>{scan.mode==='label'?'Nutrition label':'Meal'} scan is ready to review.</p><Button onClick={()=>{setActiveScanId(scan.id);go('scan');}}>Review scan</Button></div>:<div className="notice" key={scan.id}><p>{scan.error??'Scan saved on this device and will process when connected.'}</p>{scan.description&&<small>{scan.description}</small>}<div className="actions">{scan.error&&<Button onClick={()=>void run(()=>store.retryScan(scan.id))}>Retry draft</Button>}<Button variant="tertiary" onClick={()=>void store.removeScan(scan.id)}>Discard local draft</Button></div></div>)}</div>}
  </div>;

  const child=step==='batch'
    ?<FoodBasket basket={basket} store={store} date={date} onBack={()=>go('selection')} onSaved={onSaved}/>
    :step==='quick'?<QuickAdd store={store} date={date} onDone={onSaved} onDirtyChange={setStepDirty}/>
    :step==='editor'&&draft?<FoodEditor key={JSON.stringify(draft)} initial={draft} title={saveFood?'Save food · per 100 g':editing?'Edit entry':'Review'} energyUnit={energyUnit} onSave={log} onClose={()=>{if(saveFood){setSaveFood(false);setDraft(undefined);go('selection');}else onSaved();}} onDirtyChange={setStepDirty}/>
    :step==='recipe'?<RecipeEditor store={store} onClose={()=>go('selection')} onDirtyChange={setStepDirty}/>
    :step==='scan'&&activeScanId&&store.local?.scans.find(scan=>scan.id===activeScanId)?.result?<ScanReview scan={store.local.scans.find(scan=>scan.id===activeScanId)!} store={store} date={date} onClose={()=>go('selection')} onSaved={onSaved} onDirtyChange={setStepDirty} onBatch={(scanId,foods,source)=>{basket.addAiFoods(scanId,foods,source);go('batch');}}/>
    :selection;
  const steps:FoodStep[]=['selection','quick','editor','recipe','scan','batch'];
  const previousStep=useRef(step);
  const stepDirection:1|-1=steps.indexOf(step)>=steps.indexOf(previousStep.current)?1:-1;
  useEffect(()=>{previousStep.current=step;},[step]);
  const animatedChild=<MotionPanel motionKey={step} direction={stepDirection}>{child}</MotionPanel>;

  const content=!history.state?<div className="dialog-step"><p role="status">{history.error?'This date is not available on this device. Connect to load its history.':'Loading this diary date…'}</p>{history.error&&<Button onClick={history.retry}>Retry history</Button>}</div>:mealReadOnly(history.state,date)?<div className="dialog-step"><p>Meal detail is available for the latest {history.state.detailDays??90} days. Previously summarized days remain read-only.</p></div>:animatedChild;
  return <Modal open={open} onClose={close} restoreFocus={restoreFocus} title={title} description={descriptionText} dirty={stepDirty||selectionDirty} width="lg" className="food-modal">{content}</Modal>;
}

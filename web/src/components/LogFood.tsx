import {Form} from './ui/Form';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Search,ScanBarcode,Sparkles,Plus,Star,ArrowLeft,ListChecks} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {AiEstimate,Entry,Food} from '../types';
import {blankNutrients} from '../types';
import {prepareImage} from '../lib/image';
import {api,ApiError} from '../lib/api';
import {lineFromPer100,lineKey} from '../lib/foodBasket';
import {serializePortions,parsePortions} from '../lib/portions';
import {FoodMacroSummary} from './FoodMacroSummary';
import {Button} from './ui/Button';
import {Field,SelectField,TextArea} from './ui/Field';
import {FileInput} from './ui/FileInput';
import {FoodEditor,type FoodDraft} from './FoodEditor';
import {RecipeEditor,emptyRecipeDraft,emptyRecipeQuantity,type RecipeDraft,type RecipeQuantity} from './RecipeEditor';
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
import {RecentFoodCard} from './RecentFoodCard';

type SearchResult=import('../types').FoodSearchResult;
type FoodStep='selection'|'quick'|'editor'|'recipe'|'batch';
type AiMode='photo'|'label'|'description';
type AiJob={id:string;status:string;resultJson?:string|null;error?:string|null};
type BarcodeRecovery={code:string;status:number;message:string};

function isRecipe(food:Food):boolean{
  if(!food.ingredientsJson)return false;
  try{
    const parsed=JSON.parse(food.ingredientsJson);
    return Array.isArray(parsed)&&parsed.length>0;
  }catch{
    return false;
  }
}

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
  const history=useHistoryWindow(store,date);
  const basket=useFoodBasket(open);
  const [step,setStep]=useState<FoodStep>(editing?'editor':'selection');
  const [selectionPurpose,setSelectionPurpose]=useState<'log'|'recipe'>('log');
  const [recipeDraft,setRecipeDraft]=useState<RecipeDraft>(()=>emptyRecipeDraft());
  const [recipeSelected,setRecipeSelected]=useState<SearchResult>();
  const [recipeQuantity,setRecipeQuantity]=useState<RecipeQuantity>(()=>emptyRecipeQuantity());
  const recipeInitial=useRef(JSON.stringify({draft:emptyRecipeDraft(),selected:undefined,quantity:emptyRecipeQuantity()}));
  const [barcodeRecovery,setBarcodeRecovery]=useState<BarcodeRecovery>();
  const [pendingBarcode,setPendingBarcode]=useState<{code:string;purpose:'log'|'recipe'}>();
  const [pendingLinkBarcode,setPendingLinkBarcode]=useState<{code:string;purpose:'log'|'recipe'}>();
  const [stepDirty,setStepDirty]=useState(false);
  const [tab,setTab]=useState(defaultTab);
  const [query,setQuery]=useState('');
  const [savedFilter,setSavedFilter]=useState<'all'|'favourites'|'recipes'|'recent'>('all');
  const selectionRequest=useRef(0);
  const [detail,setDetail]=useState<{food:SearchResult;error?:string}|null>(null);
  useEffect(()=>{selectionRequest.current++;setDetail(null);return()=>{selectionRequest.current++;};},[open,step,tab,query]);
  const [results,setResults]=useState<SearchResult[]>([]);
  const [draft,setDraft]=useState<Partial<Entry&Food>|undefined>(editing);
  const [saveFood,setSaveFood]=useState<Food|true|false>(false);
  const [description,setDescription]=useState('');
  const [mode,setMode]=useState<AiMode>('description');
  const [photo,setPhoto]=useState<string|null>(null);
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
      setRecipeDraft(emptyRecipeDraft());
      setRecipeSelected(undefined);
      setRecipeQuantity(emptyRecipeQuantity());
      recipeInitial.current=JSON.stringify({draft:emptyRecipeDraft(),selected:undefined,quantity:emptyRecipeQuantity()});
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
      setDescription('');
      setMode('description');
      setPhoto(null);
      setLabelNote('');
      setError('');
      setCamera(false);
      setBatchTime(undefined);
      basket.clear();
    }
    wasOpen.current=open;
  },[open,editing?.id,date,defaultTab,basket]);

  useEffect(()=>{if(!open||tab!=='barcode'||step!=='selection')setCamera(false);},[open,tab,step]);

  useLayoutEffect(()=>{
    if(step==='selection')selectionRef.current?.closest<HTMLElement>('.modal-body')?.scrollTo({top:0,left:0,behavior:'auto'});
  },[step,tab]);

  useLayoutEffect(()=>{
    if(!open)return;
    const frame=window.requestAnimationFrame(()=>{
      const target=document.querySelector<HTMLElement>('.food-modal [data-modal-autofocus],.food-modal [data-validation-focus]');
      if(target?.isConnected)target.focus({preventScroll:true});
    });
    return()=>window.cancelAnimationFrame(frame);
  },[open,step,tab]);

  const run=async(fn:()=>Promise<void>)=>{setError('');try{await runAction(fn);}catch(ex){setError((ex as Error).message);}};
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
    setRecipeDraft(emptyRecipeDraft());
    setRecipeSelected(undefined);
    setRecipeQuantity(emptyRecipeQuantity());
    recipeInitial.current=JSON.stringify({draft:emptyRecipeDraft(),selected:undefined,quantity:emptyRecipeQuantity()});
    setStep('recipe');
  };
  const beginRecipeIngredient=()=>{
    setSelectionPurpose('recipe');
    setRecipeSelected(undefined);
    setRecipeQuantity(emptyRecipeQuantity());
    selectTab('search');
    setStep('selection');
  };
  const cancelRecipe=()=>{
    setSelectionPurpose('log');
    setRecipeDraft(emptyRecipeDraft());
    setRecipeSelected(undefined);
    setRecipeQuantity(emptyRecipeQuantity());
    recipeInitial.current=JSON.stringify({draft:emptyRecipeDraft(),selected:undefined,quantity:emptyRecipeQuantity()});
    setTab('saved');
    go('selection');
  };
  const cancelRecipeIngredient=()=>{
    setRecipeSelected(undefined);
    setRecipeQuantity(emptyRecipeQuantity());
    setStep('recipe');
  };
  const finishRecipe=()=>{
    setSelectionPurpose('log');
    setRecipeDraft(emptyRecipeDraft());
    setRecipeSelected(undefined);
    setRecipeQuantity(emptyRecipeQuantity());
    recipeInitial.current=JSON.stringify({draft:emptyRecipeDraft(),selected:undefined,quantity:emptyRecipeQuantity()});
    setTab('saved');
    go('selection');
  };
  const recipeSnapshot=JSON.stringify({draft:recipeDraft,selected:recipeSelected,quantity:recipeQuantity});
  const recipeDirty=recipeSnapshot!==recipeInitial.current;
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
    const barcodeContext=pendingBarcode;
    if(!Array.isArray(estimate.foods)||estimate.foods.length===0){
      if(barcodeContext&&mode==='label')throw new Error('The nutrition label must identify exactly one product. Retake the label photo and try again.');
      throw new Error(estimate.explanation||'AI could not identify a food. Add more detail and try again.');
    }
    if(barcodeContext&&mode==='label'){
      if(estimate.foods.length!==1)throw new Error('The nutrition label must identify exactly one product. Retake the label photo and try again.');
      const food=estimate.foods[0];
      const declaredGrams=food.unit==='g'
        ?food.quantity
        :(food.portionGrams!=null?food.quantity*food.portionGrams:null);
      const known=declaredGrams!=null&&Number.isFinite(declaredGrams)&&declaredGrams>0;
      const ratio=known?100/declaredGrams:1;
      const hasPortion=known&&food.unit==='serving'&&food.portionLabel&&food.portionGrams!=null;
      setLabelNote(food.notes||'');
      setSaveFood(true);
      setDraft({
        ...blankNutrients,
        name:food.name,
        source:'AI label estimate',
        quantity:known?100:1,
        unit:known?'g':'serving',
        portionLabel:known&&hasPortion?food.portionLabel??null:null,
        portionGrams:known&&hasPortion?food.portionGrams??null:null,
        calories:food.calories*ratio,
        protein:food.protein==null?null:food.protein*ratio,
        carbs:food.carbs==null?null:food.carbs*ratio,
        fat:food.fat==null?null:food.fat*ratio,
        fiber:food.fiber==null?null:food.fiber*ratio,
        portionsJson:hasPortion?serializePortions([{label:food.portionLabel!,grams:food.portionGrams!}]):'[]',
        barcode:barcodeContext.code,
      });
      setDescription('');setPhoto(null);go('editor');
      return;
    }
    basket.addAiFoods(estimate.foods,mode==='label'?'AI label estimate':'AI estimate');
    setDescription('');setPhoto(null);setLabelNote('');go('batch');
  };
  const log=async(data:FoodDraft)=>{
    if(saveFood){
      const barcodeContext=pendingBarcode;
      let savedData:FoodDraft={...data,barcode:data.barcode?.trim()||null};
      if(barcodeContext){
        if(data.unit==='serving'&&(!data.portionLabel||data.portionGrams==null))
          throw new Error('Enter the serving label and weight in grams before saving this barcode food.');
        const grams=data.unit==='g'
          ?data.quantity
          :(data.portionGrams!=null&&data.quantity>0?data.quantity*data.portionGrams:null);
        if(grams==null||!Number.isFinite(grams)||grams<=0)
          throw new Error('Enter the serving weight in grams before saving this barcode food.');
        const ratio=100/grams;
        const portions=data.unit==='serving'&&data.portionLabel&&data.portionGrams!=null
          ?serializePortions([{label:data.portionLabel,grams:data.portionGrams}])
          :data.portionsJson;
        savedData={
          ...data,
          calories:data.calories*ratio,
          protein:data.protein==null?null:data.protein*ratio,
          carbs:data.carbs==null?null:data.carbs*ratio,
          fat:data.fat==null?null:data.fat*ratio,
          fiber:data.fiber==null?null:data.fiber*ratio,
          quantity:100,
          unit:'g',
          portionLabel:null,
          portionGrams:null,
          portionsJson:portions,
          barcode:barcodeContext.code,
        };
      }
      await store.mutate({kind:'food',recordId:saveFood===true?crypto.randomUUID():saveFood.id,expectedRevision:saveFood===true?0:saveFood.revision,delete:false,data:{...savedData,servingGrams:100,favourite:saveFood===true?true:saveFood.favourite,ingredientsJson:saveFood===true?'[]':saveFood.ingredientsJson,cookedYieldGrams:saveFood===true?null:saveFood.cookedYieldGrams}});
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
  const foodToSearchResult=(food:Food):SearchResult=>({
    name:food.name,
    calories:food.calories,
    protein:food.protein,
    fat:food.fat,
    carbs:food.carbs,
    fiber:food.fiber,
    source:food.source,
    servingGrams:food.servingGrams||100,
    portions:parsePortions(food.portionsJson),
    code:barcodeValue(food.barcode),
    basis:'per100g',
  });
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
    setRecipeSelected(food);
    setRecipeQuantity({grams:food.servingGrams||food.portions?.[0]?.grams||100,selectedPortionLabel:'g',portionMultiplier:1});
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
  const favoriteCount=allSavedFoods.filter(f=>f.favourite).length;
  const recipeCount=allSavedFoods.filter(isRecipe).length;
  const recentEntries=Array.from(
    store.state!.entries
      .filter(entry=>!entry.deleted)
      .reverse()
      .reduce((map,entry)=>{
        const key=entry.name.toLowerCase().trim();
        if(!map.has(key))map.set(key,entry);
        return map;
      },new Map<string,Entry>())
      .values()
  ).slice(0,8);
  const foods=allSavedFoods.filter(food=>{
    if((selectionPurpose==='recipe'||pendingLinkBarcode)&&isRecipe(food))return false;
    const matchesQuery=!query.trim()||food.name.toLowerCase().includes(query.toLowerCase().trim());
    if(!matchesQuery)return false;
    if(savedFilter==='favourites')return food.favourite;
    if(savedFilter==='recipes')return isRecipe(food);
    return true;
  }).sort((a,b)=>Number(b.favourite)-Number(a.favourite));
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

  const selection=<div ref={selectionRef} className="dialog-step food-selection">
    {selectionPurpose==='recipe'&&<div style={{marginBottom:12}}><Button type="button" variant="tertiary" size="sm" className="subpage-back-button" onClick={cancelRecipeIngredient}><ArrowLeft size={16} aria-hidden="true"/>Back to recipe</Button></div>}
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
    {tab==='saved'&&<>
      <div className="saved-foods-header section-heading">
        <div><h3>Your foods</h3><p>{selectionPurpose==='recipe'?'Choose a saved food for this ingredient.':'Saved custom foods, recipes, and recent diary items.'}</p></div>
        {selectionPurpose==='log'&&<div className="actions saved-foods-actions">
          <Button variant="tertiary" onClick={()=>{setQuery('');setSavedFilter('all');window.requestAnimationFrame(()=>document.getElementById('log-food-search')?.focus());}}>Search</Button>
          <Button variant="secondary" onClick={()=>{setSaveFood(true);setDraft({...blankNutrients,quantity:100,unit:'g'});go('editor');}}><Plus size={16}/>Custom food</Button>
          <Button variant="secondary" onClick={startRecipe}><Plus size={16}/>New recipe</Button>
        </div>}
      </div>
      {pendingLinkBarcode&&<div className="notice barcode-link-notice" role="status">
        <p>Choose one saved non-recipe food to link to barcode {pendingLinkBarcode.code}.</p>
        <Button variant="tertiary" onClick={()=>{setPendingLinkBarcode(undefined);setTab('barcode');}}>Cancel</Button>
      </div>}
      <div className="saved-foods-search">
        <Field id="log-food-search" name="query" data-modal-autofocus label="Find your food" placeholder="Filter by food or recipe name…" value={query} onChange={event=>setQuery(event.target.value)}/>
      </div>
      <SegmentedControl<'all'|'favourites'|'recipes'|'recent'>
        layout="wrap"
        className="saved-filter-segments"
        label="Filter your foods"
        value={savedFilter}
        options={[
          {value:'all',label:`All (${allSavedFoods.length})`},
          {value:'favourites',label:`Favourites (${favoriteCount})`},
          ...(selectionPurpose==='log'&&!pendingLinkBarcode?[{value:'recipes' as const,label:`Recipes (${recipeCount})`},{value:'recent' as const,label:`Recent (${recentEntries.length})`}] : []),
        ]}
        onChange={setSavedFilter}
      />
      {selectionPurpose==='log'&&!pendingLinkBarcode&&savedFilter==='recent'?(
        recentEntries.length>0?(
          <div className="recent-foods-grid">
            {recentEntries.map(entry=><RecentFoodCard
              key={entry.id}
              entry={entry}
              energyUnit={energyUnit}
              onSelect={selected=>{setSaveFood(false);setDraft({...selected,id:undefined});go('editor');}}
            />)}
          </div>
        ):<p className="empty recent-empty">No recent diary items yet.</p>
      ):(
        <>
          {selectionPurpose==='log'&&!pendingLinkBarcode&&savedFilter==='all'&&!query.trim()&&recentEntries.length>0&&<section className="recent-foods-section" aria-labelledby="recent-section-heading">
            <div className="recent-foods-heading">
              <h4 id="recent-section-heading">Recent items</h4>
            </div>
            <div className="recent-foods-grid">
              {recentEntries.slice(0,4).map(entry=><RecentFoodCard
                key={entry.id}
                entry={entry}
                energyUnit={energyUnit}
                onSelect={selected=>{setSaveFood(false);setDraft({...selected,id:undefined});go('editor');}}
              />)}
            </div>
          </section>}
          {foods.length===0?(
            <p className="empty">
              {query.trim()
                ?`No saved foods matching “${query}”.`
                :savedFilter==='favourites'
                ?'No favourite foods yet. Star foods to find them quickly here.'
                :savedFilter==='recipes'
                ?'No recipes yet. Create one with the New recipe button.'
                :'No saved foods yet.'}
            </p>
          ):(
            foods.map(food=><div
              className="food-row interactive"
              key={food.id}
              role="button"
              aria-label={food.name}
              tabIndex={0}
              onClick={()=>chooseSaved(food)}
              onKeyDown={event=>{
                if(event.target!==event.currentTarget)return;
                if(event.key==='Enter'||event.key===' '){
                  event.preventDefault();
                  chooseSaved(food);
                }
              }}
            >
              <div className="food-description">
                <div className="saved-food-title-row">
                  <strong>{food.name}</strong>
                  {isRecipe(food)&&<span className="food-badge recipe-badge">Recipe</span>}
                </div>
                <div className="saved-food-meta">
                  <span className="saved-food-energy">{displayEnergy(food.calories,energyUnit)} {energyLabel(energyUnit)} / 100 g</span>
                  {(food.protein!=null||food.carbs!=null||food.fat!=null)&&(
                    <FoodMacroSummary protein={food.protein} carbs={food.carbs} fat={food.fat} className="food-macro-summary-inline"/>
                  )}
                </div>
              </div>
              <div className="food-row-actions" style={{display:'flex',alignItems:'center',gap:4}}>
                <Button
                  variant="tertiary"
                  className={`food-row-star ${food.favourite?'starred':''}`}
                  aria-label={`${food.favourite?'Unfavourite':'Favourite'} ${food.name}`}
                  onClick={event=>{
                    event.stopPropagation();
                    void runAction(()=>store.mutate({kind:'food',recordId:food.id,expectedRevision:food.revision,delete:false,data:{...food,favourite:!food.favourite,barcode:food.barcode??null}}));
                  }}
                >
                  <Star size={18} fill={food.favourite?'currentColor':'none'}/>
                </Button>
                {selectionPurpose==='log'&&<Button
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
                </Button>}
              </div>
            </div>)
          )}
        </>
      )}
    </>}
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
      isSaved={food=>store.state!.foods.some(f=>!f.deleted&&f.name.toLowerCase()===food.name.toLowerCase()&&f.source===food.source&&f.favourite)}
      onToggleSave={food=>void run(async()=>{
        const existing=store.state!.foods.find(f=>!f.deleted&&f.name.toLowerCase()===food.name.toLowerCase()&&f.source===food.source);
        if(existing){
          await store.mutate({kind:'food',recordId:existing.id,expectedRevision:existing.revision,delete:false,data:{...existing,favourite:!existing.favourite,barcode:existing.barcode??barcodeValue(food.code)}});
        }else{
          await store.mutate({kind:'food',recordId:crypto.randomUUID(),expectedRevision:0,delete:false,data:{...food,barcode:barcodeValue(food.code),portionsJson:serializePortions(food.portions??[]),servingGrams:100,favourite:true,ingredientsJson:'[]',cookedYieldGrams:null}});
        }
      })}
      run={run}
      open={open}
      step={step}
      energyUnit={energyUnit}
    />}
    {tab==='barcode'&&!pendingBarcode&&barcodeRecovery&&<section className="notice barcode-recovery" aria-labelledby="barcode-recovery-title">
      <h4 id="barcode-recovery-title">{barcodeRecovery.status===404?'Barcode not found in Open Food Facts':barcodeRecovery.status===422?'Open Food Facts has incomplete product data':'Open Food Facts is temporarily unavailable'}</h4>
      <p>{barcodeRecovery.status===404
        ?`No catalogue entry was found for ${barcodeRecovery.code}. The camera decoded the barcode; choose how to recover this product.`
        :barcodeRecovery.status===422
        ?`The product at ${barcodeRecovery.code} is missing reliable nutrition details. You can provide the label or use one of your saved foods.`
        :`The catalogue could not be reached for ${barcodeRecovery.code}. Retry when connected, or use a private saved-food or manual recovery.`}</p>
      <div className="actions">
        {barcodeRecovery.status!==404&&<Button variant="secondary" onClick={retryBarcode}>Retry lookup</Button>}
        <Button onClick={beginBarcodeLink}>Link an existing food</Button>
        <Button onClick={beginBarcodeLabel}>Scan nutrition label</Button>
        <Button onClick={beginBarcodeManual}>Enter manually</Button>
      </div>
    </section>}
    {(tab==='ai'||pendingBarcode)&&<Form onSubmit={()=>void run(submitAiEstimate)} className="ai-logging-form">
      {pendingBarcode&&<div className="section-heading"><div><h3>Scan nutrition label</h3><p>Barcode {pendingBarcode.code} · review the extracted values before saving.</p></div><Button type="button" variant="tertiary" onClick={()=>{setPendingBarcode(undefined);setTab('barcode');}}>Back to barcode</Button></div>}
      {!pendingBarcode&&<h3>AI logging</h3>}
      {!pendingBarcode&&<SelectField id="ai-log-mode" name="mode" disabled={busy} label="How would you like to log?" value={mode} onChange={value=>{setMode(value as AiMode);setPhoto(null);}}><option value="description">Describe my meal</option><option value="photo">Meal photo</option><option value="label">Nutrition label</option></SelectField>}
      {mode==='description'&&<TextArea id="ai-meal-description" name="description" disabled={busy} required label="Meal description and portions" maxLength={3000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="150 g coconut rice, one egg, sambal, cucumber, peanuts…"/>}
      {mode!=='description'&&<FileInput id="ai-photo-input" name="photo" validate={()=>!photo?'Choose a photo before continuing.':undefined} key={mode} disabled={busy} label={mode==='label'?'Photograph the nutrition label':'Photograph your food'} accept="image/*" capture="environment" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';setPhoto(null);if(file){void run(async()=>setPhoto(await prepareImage(file)));}}}/>}
      {photo&&mode!=='description'&&<p className="notice">Location metadata removed · deleted after processing.</p>}
      <div className="modal-actions"><Button variant="primary" disabled={busy} type="submit"><Sparkles size={18}/>{busy?'Estimating…':mode==='label'?'Read nutrition label':'Estimate my meal'}</Button></div>
    </Form>}
    {error&&<p className="error" role="alert">{error}</p>}
  </div>;

  const child=step==='batch'
    ?<FoodBasket basket={basket} store={store} date={date} onBack={()=>{selectTab('search');go('selection');}} onSaved={onSaved} initialTime={batchTime} onTimeChange={setBatchTime}/>
    :step==='quick'?<QuickAdd store={store} date={date} onDone={onSaved} onBack={()=>go('selection')} onDirtyChange={setStepDirty}/>
    :step==='editor'&&draft?<FoodEditor key={JSON.stringify(draft)} initial={draft} title={saveFood?'Save food · per 100 g':editing?'Edit entry':'Review'} labelNote={labelNote} energyUnit={energyUnit} onSave={log} onClose={()=>{if(saveFood){setSaveFood(false);setDraft(undefined);setPendingBarcode(undefined);setLabelNote('');go('selection');}else if(editing){onClose();}else{go('selection');}}} onDirtyChange={setStepDirty}/>
    :step==='recipe'?<RecipeEditor
      store={store}
      draft={recipeDraft}
      onDraftChange={setRecipeDraft}
      selected={recipeSelected}
      quantity={recipeQuantity}
      onQuantityChange={setRecipeQuantity}
      onAddIngredient={(food,grams)=>{
        setRecipeDraft(current=>({...current,items:[...current.items,{food,grams}]}));
        setRecipeSelected(undefined);
        setRecipeQuantity(emptyRecipeQuantity());
      }}
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
  const animatedChild=<MotionPanel motionKey={step} direction={stepDirection}>{child}</MotionPanel>;

  const content=!history.state?<div className="dialog-step"><p role="status" aria-busy="true">{history.error?'This date is not available on this device. Connect to load its history.':'Loading this diary date…'}</p>{history.error&&<Button onClick={history.retry}>Retry history</Button>}</div>:mealReadOnly(history.state,date)?<div className="dialog-step"><p>Meal detail is available for the latest {history.state.detailDays??90} days. Previously summarized days remain read-only.</p></div>:animatedChild;
  return <>
    <Modal open={open} onClose={close} restoreFocus={restoreFocus} title={title} description={descriptionText} headerActions={step==='selection'&&basket.lines.length>0?<Button className="batch-header-button" variant="secondary" aria-label={`View batch, ${basket.lines.length} foods`} onClick={()=>go('batch')}><ListChecks size={16} aria-hidden="true"/><span>Batch</span><span className="batch-header-separator" aria-hidden="true">·</span><span className="batch-header-count">{basket.lines.length}</span></Button>:undefined} dirty={stepDirty||selectionDirty||recipeDirty} width="lg" className="food-modal">{content}</Modal>
  </>;
}

function barcodeValue(code:string|null|undefined):string|null{
  const normalized=code?.trim()??'';
  return /^[0-9]{8,14}$/.test(normalized)?normalized:null;
}

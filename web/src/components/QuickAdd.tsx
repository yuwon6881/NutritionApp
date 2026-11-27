import {Form} from './ui/Form';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {NutritionStore} from '../useNutritionStore';
import {mealTime} from '../lib/foodDiary';
import {ArrowLeft,ChevronDown,ChevronUp} from 'lucide-react';
import {Button} from './ui/Button';
import {Field,TimePicker} from './ui/Field';
import {energyLabel,inputAmount,inputEnergy,parseEnergy,unitsFor} from '../lib/units';
import {useAsyncAction} from './ui/useAsyncAction';
import {QUICK_ADD_SOURCE} from '../lib/nutrients';

export interface QuickAddPrefill {
  calories?:number|null;
  label?:string|null;
  protein?:number|null;
  carbs?:number|null;
  fat?:number|null;
  time?:string|null;
}

function parseOptionalMacro(raw:string,name:string):number|null{
  const trimmed=raw.trim();
  if(!trimmed)return null;
  const parsed=Number(trimmed);
  if(!Number.isFinite(parsed)||parsed<0||parsed>3000){
    throw new Error(`${name} must be between 0 and 3000 g.`);
  }
  return parsed;
}

function macroFieldText(value:number|null|undefined):string{
  return value==null?'':String(inputAmount(value));
}

export function QuickAdd({
  store,
  date,
  onDone,
  onBack,
  onDirtyChange,
  initialTime,
  prefill,
}:{
  store:NutritionStore;
  date:string;
  onDone:()=>void;
  onBack?:()=>void;
  onDirtyChange?:(dirty:boolean)=>void;
  initialTime?:string;
  prefill?:QuickAddPrefill;
}){
  const energyUnit=unitsFor(store.state!.settings).energy;
  const hasPrefilledMacros=prefill?.protein!=null||prefill?.carbs!=null||prefill?.fat!=null;
  const [calories,setCalories]=useState(()=>prefill?.calories!=null?String(inputEnergy(prefill.calories,energyUnit,0)):'');
  const [label,setLabel]=useState(()=>prefill?.label?.trim()??'');
  const [time,setTime]=useState(()=>prefill?.time??initialTime??mealTime(store.state!.profile?.timeZone));
  const [showMacros,setShowMacros]=useState(hasPrefilledMacros);
  const [protein,setProtein]=useState(()=>macroFieldText(prefill?.protein));
  const [carbs,setCarbs]=useState(()=>macroFieldText(prefill?.carbs));
  const [fat,setFat]=useState(()=>macroFieldText(prefill?.fat));
  const {busy,run,pending:busyPending}=useAsyncAction();
  const [error,setError]=useState('');
  // An Ask AI draft is unsaved work, so the clean baseline is the empty form: closing a
  // prefilled Quick Add asks before discarding the draft.
  const initial=useRef(prefill?'':JSON.stringify({calories,label,time,protein,carbs,fat}));
  const snapshot=JSON.stringify({calories,label,time,protein,carbs,fat});
  useEffect(()=>onDirtyChange?.(snapshot!==initial.current),[snapshot,onDirtyChange]);

  const save=async(event:FormEvent)=>{
    event.preventDefault();if(busyPending)return;setError('');
    try{
      const parsed=parseEnergy(calories,energyUnit);
      if(!Number.isFinite(parsed))throw new Error(`Enter calories in ${energyLabel(energyUnit)}.`);
      const parsedProtein=parseOptionalMacro(protein,'Protein');
      const parsedCarbs=parseOptionalMacro(carbs,'Carbs');
      const parsedFat=parseOptionalMacro(fat,'Fat');
      const entryName=label.trim()||'Quick add';
      await run(()=>store.mutate({
        kind:'entry',
        recordId:crypto.randomUUID(),
        expectedRevision:0,
        delete:false,
        data:{
          date,
          time,
          name:entryName,
          calories:parsed,
          quantity:1,
          unit:'serving',
          portionLabel:null,
          portionGrams:null,
          protein:parsedProtein,
          fat:parsedFat,
          carbs:parsedCarbs,
          fiber:null,
          source:QUICK_ADD_SOURCE,
        },
      }));
      onDone();
    }catch(ex){setError((ex as Error).message);}
  };

  const hasMacros=Boolean(protein.trim()||carbs.trim()||fat.trim());
  const submitLabel=busy?'Saving…':(hasMacros||label.trim())?'Add entry':'Add calories';

  return <div className="dialog-step editor quick-add"><Form onSubmit={save}>
    {onBack&&<div className="editor-back-nav">
      <Button type="button" variant="tertiary" size="sm" className="subpage-back-button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true"/>Back
      </Button>
    </div>}
    <Field id="quick-add-calories" name="calories" className="quick-add-calories" placeholder="0" enterKeyHint="done" label={`Calories (${energyLabel(energyUnit)})`} type="number" min="0" max={energyUnit==='kj'?83680:20000} step="any" required value={calories} onChange={event=>setCalories(event.target.value)}/>
    <Field id="quick-add-label" name="label" label="Label (optional)" maxLength={160} placeholder="Quick add (e.g. Restaurant lunch)" value={label} onChange={event=>setLabel(event.target.value)}/>
    <TimePicker id="quick-add-time" name="time" label="Meal time" required value={time} onChange={setTime}/>
    <div className="quick-add-macros-section">
      <Button type="button" variant="tertiary" size="sm" className="quick-add-macros-toggle" aria-expanded={showMacros} onClick={()=>setShowMacros(open=>!open)}>
        {showMacros?<ChevronUp size={16} aria-hidden="true"/>:<ChevronDown size={16} aria-hidden="true"/>}
        <span>{showMacros?'Hide macros':'Macros (optional)'}</span>
      </Button>
      {showMacros&&<div className="quick-add-macros-grid">
        <Field id="quick-add-protein" name="protein" label="Protein (g)" type="number" min="0" max="3000" step="any" placeholder="Optional" value={protein} onChange={event=>setProtein(event.target.value)}/>
        <Field id="quick-add-carbs" name="carbs" label="Carbs (g)" type="number" min="0" max="3000" step="any" placeholder="Optional" value={carbs} onChange={event=>setCarbs(event.target.value)}/>
        <Field id="quick-add-fat" name="fat" label="Fat (g)" type="number" min="0" max="3000" step="any" placeholder="Optional" value={fat} onChange={event=>setFat(event.target.value)}/>
      </div>}
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="modal-actions">
      <Button type="submit" variant="primary" disabled={busyPending}>{submitLabel}</Button>
    </div>
  </Form></div>;
}

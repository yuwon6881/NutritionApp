import {Form} from './ui/Form';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Trash2,Plus} from 'lucide-react';
import type {EnergyUnit,Entry,Food,Nutrients} from '../types';
import {blankNutrients} from '../types';
import {Button} from './ui/Button';
import {Field,SelectField,TimePicker} from './ui/Field';

import {nutrientRescaleWarning,rescaleNutrients} from '../lib/nutrients';
import {parsePortions,serializePortions,validatePortions} from '../lib/portions';
import {energyLabel,inputEnergy,parseEnergy} from '../lib/units';
import {number} from '../lib/format';
import {useAsyncAction} from './ui/useAsyncAction';

export type FoodDraft=Nutrients&{
  quantity:number;
  unit:'g'|'serving';
  time?:string|null;
  portionLabel:string|null;
  portionGrams:number|null;
  portionsJson:string;
};

type FoodEditorInitial=Partial<Entry&Food>&{portionsJson?:string;portions?:{label:string;grams:number}[]};
type PortionDraft={label:string;grams:string};

function initialPortions(initial?:FoodEditorInitial){
  return Array.isArray(initial?.portions)
    ? parsePortions(JSON.stringify(initial.portions))
    : parsePortions(initial?.portionsJson);
}

function makeDraft(initial?:FoodEditorInitial):FoodDraft{
  const portions=initialPortions(initial);
  return {
    ...blankNutrients,
    quantity:1,
    unit:'serving',
    ...initial,
    portionLabel:initial?.portionLabel??null,
    portionGrams:initial?.portionGrams??null,
    portionsJson:serializePortions(portions),
  };
}

export function FoodEditor({
  initial,
  onSave,
  onClose,
  title='Review your food',
  onDirtyChange,
  energyUnit='kcal',
}:{
  initial?:FoodEditorInitial;
  onSave:(draft:FoodDraft)=>Promise<void>;
  onClose:()=>void;
  title?:string;
  onDirtyChange?:(dirty:boolean)=>void;
  energyUnit?:EnergyUnit;
}){
  const [draft,setDraft]=useState<FoodDraft>(()=>makeDraft(initial));
  const [portionDrafts,setPortionDrafts]=useState<PortionDraft[]>(()=>initialPortions(initial).map(portion=>({label:portion.label,grams:String(portion.grams)})));
  const [error,setError]=useState('');
  const [portionError,setPortionError]=useState('');
  const [basisWarning,setBasisWarning]=useState('');
  const {busy,run}=useAsyncAction();
  const initialDraft=useRef(JSON.stringify({
    draft:makeDraft(initial),
    portionDrafts:initialPortions(initial).map(portion=>({label:portion.label,grams:String(portion.grams)})),
  }));

  useEffect(()=>onDirtyChange?.(JSON.stringify({draft,portionDrafts})!==initialDraft.current),[draft,portionDrafts,onDirtyChange]);

  const set=(key:keyof FoodDraft,value:unknown)=>setDraft(current=>{
    if(key==='quantity')return rescaleNutrients(current,typeof value==='number'?value:current.quantity);
    return {...current,[key]:value};
  });

  const setBasis=(next:Partial<Pick<FoodDraft,'quantity'|'unit'|'portionLabel'|'portionGrams'>>)=>{
    setBasisWarning(nutrientRescaleWarning(draft,next)??'');
    setDraft(current=>rescaleNutrients(current,next));
  };

  const portions=parsePortions(draft.portionsJson);
  const unitChoice=draft.unit==='g'?'g':draft.portionLabel?`portion:${draft.portionLabel}`:'serving';
  const unitOptions=[
    {value:'g',label:'Grams'},
    ...portions.map(portion=>({value:`portion:${portion.label}`,label:`${portion.label} · ${portion.grams} g`})),
    ...(draft.portionLabel&&!portions.some(portion=>portion.label.toLocaleLowerCase()===draft.portionLabel!.toLocaleLowerCase())
      ?[{value:`portion:${draft.portionLabel}`,label:`${draft.portionLabel}${draft.portionGrams==null?'':` · ${draft.portionGrams} g`}`}]
      :[]),
    {value:'serving',label:'Serving (weight unknown)'},
  ];
  const showPortionDefinitions=title.startsWith('Save food')||Boolean(initial?.portionsJson)||Boolean(initial?.portions?.length);

  const syncPortionDrafts=(next:PortionDraft[])=>{
    setPortionDrafts(next);
    if(next.every(item=>item.label.trim()&&Number.isFinite(Number(item.grams)))){
      try{
        setDraft(current=>({...current,portionsJson:serializePortions(next.map(item=>({label:item.label,grams:Number(item.grams)})))}));
        setPortionError('');
      }catch(ex){setPortionError((ex as Error).message);}
    }
  };

  const save=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;setError('');
    try{
      let next=draft;
      if(showPortionDefinitions){
        try{
          const portions=validatePortions(portionDrafts.map(item=>({label:item.label,grams:Number(item.grams)})));
          next={...draft,portionsJson:serializePortions(portions)};
          setPortionError('');
        }catch(ex){setPortionError((ex as Error).message);return;}
      }
      await run(()=>onSave(next));
    }
    catch(ex){setError((ex as Error).message);}
  };

  const isProviderFood = !title.startsWith('Edit batch') && !title.startsWith('Save food') && draft.source !== 'manual' && draft.source !== 'Quick add';
  const submitLabel = busy ? 'Saving…' : title.startsWith('Save food') ? 'Save custom food' : title.startsWith('Edit') ? 'Save changes' : 'Add to batch';

  return <div className="dialog-step editor">
    <Form onSubmit={save}>
      {isProviderFood ? (
        <>
          <div className="review-food-heading" style={{marginBottom: 14}}>
            <h3 style={{fontSize: '1.2rem', marginBottom: 4, color: 'var(--foreground)'}}>{draft.name}</h3>
            <small className="source">{draft.source}</small>
          </div>

          <div className="live-calorie-card" style={{margin: '12px 0 18px'}}>
            <div className="live-calorie-header">
              <span className="live-calorie-tag">CALORIES</span>
              <div className="live-calorie-value">
                <strong>{inputEnergy(draft.calories, energyUnit, 0)}</strong> <span className="unit">{energyLabel(energyUnit)}</span>
              </div>
            </div>
            <div className="live-calorie-meta">
              <span className="live-macros">
                Protein {number(draft.protein, 1)} g · Carbs {number(draft.carbs, 1)} g · Fat {number(draft.fat, 1)} g{draft.fiber != null ? ` · Fibre ${number(draft.fiber, 1)} g` : ''}
              </span>
            </div>
          </div>

          <div className="form-grid">
            <Field id="food-quantity" name="quantity" data-modal-autofocus label="Quantity" type="number" min="0.001" max="100000" step="any" required value={draft.quantity} onChange={event=>set('quantity',Number(event.target.value))}/>
            <SelectField id="food-unit" name="unit" label="Unit" value={unitChoice} onChange={value=>{
              if(value==='g')setBasis({unit:'g',portionLabel:null,portionGrams:null});
              else if(value==='serving')setBasis({quantity:1,unit:'serving',portionLabel:null,portionGrams:null});
              else{
                const selected=portions.find(portion=>`portion:${portion.label}`===value);
                if(selected)setBasis({quantity:1,unit:'serving',portionLabel:selected.label,portionGrams:selected.grams});
              }
            }} options={unitOptions}/>
            <TimePicker id="food-time" name="time" label="Meal time" value={draft.time??''} onChange={val=>set('time',val||null)} hint={!draft.time?'Time not recorded':undefined}/>
          </div>
        </>
      ) : (
        <>
          <Field id="food-name" name="name" data-modal-autofocus label="Food name" required maxLength={160} value={draft.name} onChange={event=>set('name',event.target.value)}/>
          {!title.startsWith('Save food')&&!title.startsWith('Edit batch')&&<TimePicker id="food-time" name="time" label="Meal time" value={draft.time??''} onChange={val=>set('time',val||null)} hint={!draft.time?'Time not recorded':undefined}/>}
          <div className="form-grid">
            <Field id="food-quantity" name="quantity" readOnly={title.startsWith('Save food')} label="Quantity" type="number" min="0.001" max="100000" step="any" required value={draft.quantity} onChange={event=>set('quantity',Number(event.target.value))}/>
            <SelectField id="food-unit" name="unit" disabled={title.startsWith('Save food')} label="Unit" value={unitChoice} onChange={value=>{
              if(value==='g')setBasis({unit:'g',portionLabel:null,portionGrams:null});
              else if(value==='serving')setBasis({quantity:1,unit:'serving',portionLabel:null,portionGrams:null});
              else{
                const selected=portions.find(portion=>`portion:${portion.label}`===value);
                if(selected)setBasis({quantity:1,unit:'serving',portionLabel:selected.label,portionGrams:selected.grams});
              }
            }} options={unitOptions}/>
            <Field id="food-calories" name="calories" label={`Calories (${energyLabel(energyUnit)})`} type="number" min="0" max={energyUnit==='kj'?83680:20000} step="any" required value={inputEnergy(draft.calories,energyUnit,0)} onChange={event=>{const parsed=parseEnergy(event.target.value,energyUnit);set('calories',Number.isFinite(parsed)?parsed:0);}}/>
            {(['protein','carbs','fat','fiber'] as const).map(key=><Field id={`food-${key}`} name={key} key={key} label={`${key[0].toUpperCase()+key.slice(1)} (g)`} type="number" min="0" max="3000" step="any" value={draft[key]??''} placeholder="Unknown" onChange={event=>set(key,event.target.value===''?null:Number(event.target.value))}/>)}
          </div>
        </>
      )}
      {!isProviderFood && draft.unit==='serving'&&<div className="form-grid">
        <Field id="food-portion-label" name="portionLabel" label="Portion label (optional)" maxLength={24} validate={()=>draft.portionGrams!=null&&!draft.portionLabel?'Add a portion label or clear its weight.':undefined} value={draft.portionLabel??''} onChange={event=>setBasis({unit:'serving',portionLabel:event.target.value||null,portionGrams:draft.portionGrams})}/>
        <Field id="food-portion-grams" name="portionGrams" label="Portion weight (g)" type="number" min="0.1" max="10000" step="any" validate={()=>draft.portionLabel&&draft.portionGrams==null?'Add a portion weight or clear its label.':undefined} value={draft.portionGrams??''} onChange={event=>setBasis({unit:'serving',portionLabel:draft.portionLabel,portionGrams:event.target.value===''?null:Number(event.target.value)})} hint="Used to rescale nutrients when the serving basis changes."/>
      </div>}
      {!isProviderFood && basisWarning&&<p className="notice" role="status">{basisWarning}</p>}
      {!isProviderFood && showPortionDefinitions&&<fieldset className="portion-definitions">
        <legend>Saved portion definitions</legend>
        <p className="source">Optional household portions for this food. Nutrients remain per 100 g.</p>
        {portionDrafts.map((portion,index)=><div className="portion-definition-row" key={index}>
          <Field id={`food-portion-definition-${index}-label`} name={`portion_${index}_label`} label="Label" maxLength={24} value={portion.label} onChange={event=>syncPortionDrafts(portionDrafts.map((item,itemIndex)=>itemIndex===index?{...item,label:event.target.value}:item))}/>
          <Field id={`food-portion-definition-${index}-grams`} name={`portion_${index}_grams`} label="Weight (g)" type="number" min="0.1" max="10000" step="any" value={portion.grams} onChange={event=>syncPortionDrafts(portionDrafts.map((item,itemIndex)=>itemIndex===index?{...item,grams:event.target.value}:item))}/>
          <Button type="button" variant="tertiary" aria-label={`Remove portion ${portion.label||index+1}`} onClick={()=>syncPortionDrafts(portionDrafts.filter((_,itemIndex)=>itemIndex!==index))}><Trash2 size={16}/></Button>
        </div>)}
        <Button type="button" variant="secondary" onClick={()=>setPortionDrafts(current=>[...current,{label:'',grams:''}])}><Plus size={16}/>Add portion</Button>
        {portionError&&<p className="error" role="alert">{portionError}</p>}
      </fieldset>}
      {!isProviderFood&&<p className="source">Source: {draft.source}</p>}
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions"><Button variant="primary" disabled={busy} type="submit">{submitLabel}</Button></div>
    </Form>
  </div>;
}

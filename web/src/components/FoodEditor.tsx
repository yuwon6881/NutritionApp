import {Form} from './ui/Form';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {EnergyUnit,Entry,Nutrients} from '../types';
import {blankNutrients} from '../types';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';

import {rescaleNutrients} from '../lib/nutrients';
import {energyLabel,inputEnergy,parseEnergy} from '../lib/units';
import {useAsyncAction} from './ui/useAsyncAction';

export type FoodDraft=Nutrients&{quantity:number;unit:'g'|'serving';meal:string;time?:string|null};

export function FoodEditor({
  initial,
  onSave,
  onClose,
  title='Review your food',
  onDirtyChange,
  energyUnit='kcal',
}:{
  initial?:Partial<Entry>;
  onSave:(draft:FoodDraft)=>Promise<void>;
  onClose:()=>void;
  title?:string;
  onDirtyChange?:(dirty:boolean)=>void;
  energyUnit?:EnergyUnit;
}){
  const [draft,setDraft]=useState<FoodDraft>({...blankNutrients,quantity:1,unit:'serving',meal:'Meal',...initial});
  const [error,setError]=useState('');
  const {busy,run}=useAsyncAction();
  const initialDraft=useRef(JSON.stringify({...blankNutrients,quantity:1,unit:'serving',meal:'Meal',...initial}));

  useEffect(()=>onDirtyChange?.(JSON.stringify(draft)!==initialDraft.current),[draft,onDirtyChange]);

  const set=(key:keyof FoodDraft,value:unknown)=>setDraft(current=>{
    if(key==='quantity')return rescaleNutrients(current,value);
    return {...current,[key]:value};
  });

  const save=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;setError('');
    try{await run(()=>onSave(draft));onClose();}
    catch(ex){setError((ex as Error).message);}
  };

  return <div className="dialog-step editor">
    <Form onSubmit={save}>
      <Field id="food-name" name="name" data-modal-autofocus label="Food name" required maxLength={160} value={draft.name} onChange={event=>set('name',event.target.value)}/>
      {!title.startsWith('Save food')&&<Field id="food-time" name="time" label="Meal time" type="time" value={draft.time??''} onChange={event=>set('time',event.target.value||null)} hint={!draft.time?'Time not recorded':undefined}/>}
      <div className="form-grid">
        <Field id="food-quantity" name="quantity" readOnly={title.startsWith('Save food')} label="Quantity" type="number" min="0.001" max="100000" step="any" required value={draft.quantity} onChange={event=>set('quantity',Number(event.target.value))}/>
        <SelectField id="food-unit" name="unit" disabled={title.startsWith('Save food')} label="Unit" value={draft.unit} onChange={value=>set('unit',value)}><option value="serving">serving</option><option value="g">grams</option></SelectField>
        <Field id="food-meal" name="meal" label="Meal" required maxLength={80} value={draft.meal} onChange={event=>set('meal',event.target.value)}/>
        <Field id="food-calories" name="calories" label={`Calories (${energyLabel(energyUnit)})`} type="number" min="0" max={energyUnit==='kj'?83680:20000} step="any" required value={inputEnergy(draft.calories,energyUnit,0)} onChange={event=>{const parsed=parseEnergy(event.target.value,energyUnit);set('calories',Number.isFinite(parsed)?parsed:0);}}/>
        {(['protein','carbs','fat','fiber'] as const).map(key=><Field id={`food-${key}`} name={key} key={key} label={`${key[0].toUpperCase()+key.slice(1)} (g)`} type="number" min="0" max="3000" step="any" value={draft[key]??''} placeholder="Unknown" onChange={event=>set(key,event.target.value===''?null:Number(event.target.value))}/>)}
      </div>
      <p className="source">Source: {draft.source}</p>
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="modal-actions"><Button variant="primary" disabled={busy} type="submit">{busy?'Saving…':'Save reviewed food'}</Button></div>
    </Form>
  </div>;
}

import {useState} from 'react';
import type {Entry,Nutrients} from '../types';
import {blankNutrients} from '../types';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
export type FoodDraft=Nutrients&{quantity:number;unit:'g'|'serving';meal:string};
export function FoodEditor({initial,onSave,onClose,title='Review your food'}:{initial?:Partial<Entry>;onSave:(draft:FoodDraft)=>Promise<void>;onClose:()=>void;title?:string}){
  const [draft,setDraft]=useState<FoodDraft>({...blankNutrients,quantity:1,unit:'serving',meal:'Meal',...initial});const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const set=(key:keyof FoodDraft,value:unknown)=>setDraft(d=>{
    if(key==='quantity'&&typeof value==='number'&&d.quantity>0&&value>0){const ratio=value/d.quantity;return {...d,quantity:value,calories:d.calories*ratio,protein:d.protein==null?null:d.protein*ratio,fat:d.fat==null?null:d.fat*ratio,carbs:d.carbs==null?null:d.carbs*ratio,fiber:d.fiber==null?null:d.fiber*ratio};}
    return {...d,[key]:value};
  });
  return <section className="panel editor"><div className="section-heading"><h2>{title}</h2><Button variant="tertiary" onClick={onClose}>Close</Button></div><p>Nutrition values below are totals for the quantity shown. Leave unknown nutrients blank.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onSave(draft);onClose();}catch(ex){setError((ex as Error).message);}finally{setBusy(false);}}}>
    <Field label="Food name" required maxLength={160} value={draft.name} onChange={e=>set('name',e.target.value)}/><div className="form-grid"><Field readOnly={title.startsWith("Save food")} label="Quantity" type="number" min="0.001" max="100000" step="any" required value={draft.quantity} onChange={e=>set('quantity',Number(e.target.value))}/><SelectField disabled={title.startsWith("Save food")} label="Unit" value={draft.unit} onChange={v=>set('unit',v)}><option value="serving">serving</option><option value="g">grams</option></SelectField><Field label="Meal" required maxLength={80} value={draft.meal} onChange={e=>set('meal',e.target.value)}/><Field label="Calories (kcal)" type="number" min="0" max="20000" step="any" required value={draft.calories} onChange={e=>set('calories',Number(e.target.value))}/>{(['protein','carbs','fat','fiber'] as const).map(key=><Field key={key} label={`${key[0].toUpperCase()+key.slice(1)} (g)`} type="number" min="0" max="3000" step="any" value={draft[key]??''} placeholder="Unknown" onChange={e=>set(key,e.target.value===''?null:Number(e.target.value))}/>)}</div><p className="source">Source: {draft.source}</p>{error&&<p role="alert" className="error">{error}</p>}<Button variant="primary" disabled={busy} type="submit">{busy?'Saving on this device…':'Save reviewed food'}</Button></form></section>;
}

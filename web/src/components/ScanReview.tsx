import {Form} from './ui/Form';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import type {ScanDraft,AiFood} from '../types';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {mealTime} from '../lib/foodDiary';

export function ScanReview({scan,store,date,onClose,onSaved,onDirtyChange}:{scan:ScanDraft;store:Nourish;date:string;onClose:()=>void;onSaved?:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
  const [foods,setFoods]=useState(scan.result?.foods??[]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [time,setTime]=useState(()=>mealTime(store.state!.profile?.timeZone));
  const [meal,setMeal]=useState('Meal');
  const initial=useRef(JSON.stringify({foods:scan.result?.foods??[],time:mealTime(store.state!.profile?.timeZone),meal:'Meal'}));
  const snapshot=JSON.stringify({foods,time,meal});

  useEffect(()=>onDirtyChange?.(snapshot!==initial.current),[snapshot,onDirtyChange]);

  const edit=(index:number,key:keyof AiFood,value:unknown)=>setFoods(current=>current.map((food,itemIndex)=>itemIndex===index?{...food,[key]:value}:food));
  const save=async(event:FormEvent)=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      await store.saveReviewedScan(scan.id,foods.map(food=>({...food,date,time,meal,source:scan.mode==='label'?'AI label · reviewed':'AI estimate · reviewed'})));
      (onSaved??onClose)();
    }catch(ex){setError((ex as Error).message);}finally{setBusy(false);}
  };

  return <div className="dialog-step scan-review">
    <div className="notice"><strong>Editable estimate</strong><p>Review the quantities and nutrients before adding this scan to your diary.</p></div>
    {scan.result!.questions.length>0&&<ul>{scan.result!.questions.map((question,index)=><li key={index}>{question}</li>)}</ul>}
    <Form onSubmit={save}>
      <div className="form-grid"><Field id="scan-meal" name="meal" label="Meal" required maxLength={80} value={meal} onChange={event=>setMeal(event.target.value)}/><Field id="scan-time" name="time" label="Meal time" type="time" required value={time} onChange={event=>setTime(event.target.value)}/></div>
      {foods.map((food,index)=><fieldset key={index}><legend>Food {index+1}</legend><Field id={`scan-food-${index}-name`} name={`food_${index}_name`} data-modal-autofocus={index===0?true:undefined} label="Name" required maxLength={160} value={food.name} onChange={event=>edit(index,'name',event.target.value)}/><p>{food.notes}</p><div className="form-grid"><SelectField id={`scan-food-${index}-unit`} name={`food_${index}_unit`} label="Quantity unit" value={food.unit} onChange={value=>edit(index,'unit',value)}><option value="g">Grams</option><option value="serving">Servings</option></SelectField><Field id={`scan-food-${index}-quantity`} name={`food_${index}_quantity`} label={`Quantity (${food.unit})`} type="number" min="0.001" max="100000" required step="any" value={food.quantity} onChange={event=>edit(index,'quantity',Number(event.target.value))}/><Field id={`scan-food-${index}-calories`} name={`food_${index}_calories`} label="Calories for this quantity" type="number" min="0" max="20000" required step="any" value={food.calories} onChange={event=>edit(index,'calories',Number(event.target.value))}/>{(['protein','carbs','fat','fiber'] as const).map(key=><Field id={`scan-food-${index}-${key}`} name={`food_${index}_${key}`} key={key} label={`${key} (g)`} type="number" min="0" max="3000" step="any" value={food[key]??''} placeholder="Unknown" onChange={event=>edit(index,key,event.target.value===''?null:Number(event.target.value))}/>)}</div><Button type="button" variant="tertiary" onClick={()=>setFoods(current=>current.filter((_,itemIndex)=>itemIndex!==index))}>Remove this food</Button></fieldset>)}
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="submit" variant="primary" disabled={!foods.length||busy}>{busy?'Saving…':`Add reviewed meal to ${date}`}</Button><Button type="button" variant="destructive" disabled={busy} onClick={()=>{void store.removeScan(scan.id);onClose();}}>Discard draft</Button></div>
    </Form>
  </div>;
}

import {Form} from './ui/Form';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import type {ScanDraft,AiFood} from '../types';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {mealTime} from '../lib/foodDiary';
import {energyLabel,inputEnergy,parseEnergy,unitsFor} from '../lib/units';
import {nutrientRescaleWarning,rescaleNutrients} from '../lib/nutrients';
import {useAsyncAction} from './ui/useAsyncAction';

export function ScanReview({scan,store,date,onClose,onSaved,onDirtyChange,onBatch}:{scan:ScanDraft;store:Nourish;date:string;onClose:()=>void;onSaved?:()=>void;onDirtyChange?:(dirty:boolean)=>void;onBatch?:(scanId:string,foods:AiFood[],source:string)=>void}){
  const [foods,setFoods]=useState(scan.result?.foods??[]);
  const {busy,run}=useAsyncAction();
  const [error,setError]=useState('');
  const [time,setTime]=useState(()=>mealTime(store.state!.profile?.timeZone));
  const [meal,setMeal]=useState('Meal');
  const [basisWarnings,setBasisWarnings]=useState<Record<number,string|undefined>>({});
  const energyUnit=unitsFor(store.state!.settings).energy;
  const initial=useRef(JSON.stringify({foods:scan.result?.foods??[],time:mealTime(store.state!.profile?.timeZone),meal:'Meal'}));
  const snapshot=JSON.stringify({foods,time,meal});

  useEffect(()=>onDirtyChange?.(snapshot!==initial.current),[snapshot,onDirtyChange]);

  const edit=(index:number,key:keyof AiFood,value:unknown)=>setFoods(current=>current.map((food,itemIndex)=>itemIndex===index?{...food,[key]:value}:food));
  const editBasis=(index:number,next:Partial<Pick<AiFood,'unit'|'portionLabel'|'portionGrams'>>)=>{
    const current=foods[index];
    if(!current)return;
    setBasisWarnings(previous=>({...previous,[index]:nutrientRescaleWarning(current,next)}));
    setFoods(items=>items.map((food,itemIndex)=>itemIndex===index?rescaleNutrients(food,next):food));
  };
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;setError('');
    try{
      await run(()=>store.saveReviewedScan(scan.id,foods.map(food=>({...food,date,time,meal,source:scan.mode==='label'?'AI label · reviewed':'AI estimate · reviewed'}))));
      (onSaved??onClose)();
    }catch(ex){setError((ex as Error).message);}
  };

  return <div className="dialog-step scan-review">
    <div className="notice"><strong>Editable estimate</strong><p>Review the quantities and nutrients before adding this scan to your diary.</p></div>
    {scan.result!.questions.length>0&&<ul>{scan.result!.questions.map((question,index)=><li key={index}>{question}</li>)}</ul>}
    <Form onSubmit={save}>
      <div className="form-grid"><Field id="scan-meal" name="meal" label="Meal" required maxLength={80} value={meal} onChange={event=>setMeal(event.target.value)}/><Field id="scan-time" name="time" label="Meal time" type="time" required value={time} onChange={event=>setTime(event.target.value)}/></div>
      {foods.map((food,index)=>{
        const portionOption=food.portionLabel&&food.portionGrams!=null?{value:`portion:${food.portionLabel}`,label:`${food.portionLabel} · ${food.portionGrams} g`}:undefined;
        const unitChoice=food.unit==='g'?'g':portionOption?portionOption.value:'serving';
        const options=[{value:'g',label:'Grams'},...(portionOption?[portionOption]:[]),{value:'serving',label:'Serving (weight unknown)'}];
        return <fieldset key={index}><legend>Food {index+1}</legend><Field id={`scan-food-${index}-name`} name={`food_${index}_name`} data-modal-autofocus={index===0?true:undefined} label="Name" required maxLength={160} value={food.name} onChange={event=>edit(index,'name',event.target.value)}/><p>{food.notes}</p><div className="form-grid"><SelectField id={`scan-food-${index}-unit`} name={`food_${index}_unit`} label="Quantity unit" value={unitChoice} options={options} onChange={value=>{
          if(value==='g')editBasis(index,{unit:'g',portionLabel:null,portionGrams:null});
          else if(value==='serving')editBasis(index,{unit:'serving',portionLabel:null,portionGrams:null});
          else if(portionOption)editBasis(index,{unit:'serving',portionLabel:food.portionLabel,portionGrams:food.portionGrams});
        }}/><Field id={`scan-food-${index}-quantity`} name={`food_${index}_quantity`} label={`Quantity (${food.unit==='g'?'g':food.portionLabel??'serving'})`} type="number" min="0.001" max="100000" required step="any" value={food.quantity} onChange={event=>edit(index,'quantity',Number(event.target.value))}/>{food.unit==='serving'&&<><Field id={`scan-food-${index}-portion-label`} name={`food_${index}_portion_label`} label="Portion label" maxLength={24} validate={()=>food.portionGrams!=null&&!food.portionLabel?'Add a portion label or clear its weight.':undefined} value={food.portionLabel??''} onChange={event=>editBasis(index,{unit:'serving',portionLabel:event.target.value||null,portionGrams:food.portionGrams})}/><Field id={`scan-food-${index}-portion-grams`} name={`food_${index}_portion_grams`} label="Portion weight (g)" type="number" min="0.1" max="10000" step="any" validate={()=>food.portionLabel&&food.portionGrams==null?'Add a portion weight or clear its label.':undefined} value={food.portionGrams??''} onChange={event=>editBasis(index,{unit:'serving',portionLabel:food.portionLabel,portionGrams:event.target.value===''?null:Number(event.target.value)})}/></>}<Field id={`scan-food-${index}-calories`} name={`food_${index}_calories`} label={`Calories for this quantity${energyUnit==='kcal'?'':` (${energyUnit})`}`} type="number" min="0" max={energyUnit==='kj'?83680:20000} required step="any" value={inputEnergy(food.calories,energyUnit,0)} onChange={event=>{const parsed=parseEnergy(event.target.value,energyUnit);edit(index,'calories',Number.isFinite(parsed)?parsed:0);}}/>{(['protein','carbs','fat','fiber'] as const).map(key=><Field id={`scan-food-${index}-${key}`} name={`food_${index}_${key}`} key={key} label={`${key} (g)`} type="number" min="0" max="3000" step="any" value={food[key]??''} placeholder="Unknown" onChange={event=>edit(index,key,event.target.value===''?null:Number(event.target.value))}/>)}</div>{basisWarnings[index]&&<p className="notice" role="status">{basisWarnings[index]}</p>}<Button type="button" variant="tertiary" onClick={()=>setFoods(current=>current.filter((_,itemIndex)=>itemIndex!==index))}>Remove this food</Button></fieldset>;
      })}
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        {onBatch&&<Button type="button" variant="secondary" disabled={!foods.length||busy} onClick={()=>onBatch(scan.id,foods,scan.mode==='label'?'AI label · reviewed':'AI estimate · reviewed')}>Add these foods to the batch</Button>}
        <Button type="submit" variant="primary" disabled={!foods.length||busy}>{busy?'Saving…':`Add reviewed meal to ${date}`}</Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={()=>{void store.removeScan(scan.id);onClose();}}>Discard draft</Button>
      </div>
    </Form>
  </div>;
}

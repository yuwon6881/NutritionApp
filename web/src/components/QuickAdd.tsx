import {Form} from './ui/Form';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import {mealTime} from '../lib/foodDiary';
import {Button} from './ui/Button';
import {Field} from './ui/Field';

export function QuickAdd({store,date,onDone,onDirtyChange}:{store:Nourish;date:string;onDone:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
  const [calories,setCalories]=useState('');
  const [meal,setMeal]=useState('Meal');
  const [time,setTime]=useState(()=>mealTime(store.state!.profile?.timeZone));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const initial=useRef(JSON.stringify({calories:'',meal:'Meal',time}));
  const snapshot=JSON.stringify({calories,meal,time});
  useEffect(()=>onDirtyChange?.(snapshot!==initial.current),[snapshot,onDirtyChange]);

  const save=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      await store.mutate({kind:'entry',recordId:crypto.randomUUID(),expectedRevision:0,delete:false,data:{date,time,meal:meal.trim()||'Meal',name:'Quick add',calories:Number(calories),quantity:1,unit:'serving',protein:null,fat:null,carbs:null,fiber:null,source:'Quick add'}});
      onDone();
    }catch(ex){setError((ex as Error).message);}finally{setBusy(false);}
  };

  return <div className="dialog-step editor"><Form onSubmit={save}>
    <Field id="quick-add-calories" name="calories" data-modal-autofocus label="Calories (kcal)" type="number" min="0" max="20000" step="any" required value={calories} onChange={event=>setCalories(event.target.value)}/>
    <div className="form-grid"><Field id="quick-add-meal" name="meal" label="Meal" maxLength={80} value={meal} onChange={event=>setMeal(event.target.value)}/><Field id="quick-add-time" name="time" label="Meal time" type="time" required value={time} onChange={event=>setTime(event.target.value)}/></div>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="modal-actions"><Button type="submit" variant="primary" disabled={busy}>{busy?'Saving…':'Add calories'}</Button></div>
  </Form></div>;
}

import {Form} from './ui/Form';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import {mealTime} from '../lib/foodDiary';
import {ArrowLeft} from 'lucide-react';
import {Button} from './ui/Button';
import {Field,TimePicker} from './ui/Field';
import {energyLabel,parseEnergy,unitsFor} from '../lib/units';
import {useAsyncAction} from './ui/useAsyncAction';

export function QuickAdd({store,date,onDone,onBack,onDirtyChange}:{store:Nourish;date:string;onDone:()=>void;onBack?:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
  const [calories,setCalories]=useState('');
  const [time,setTime]=useState(()=>mealTime(store.state!.profile?.timeZone));
  const {busy,run}=useAsyncAction();
  const [error,setError]=useState('');
  const energyUnit=unitsFor(store.state!.settings).energy;
  const initial=useRef(JSON.stringify({calories:'',time}));
  const snapshot=JSON.stringify({calories,time});
  useEffect(()=>onDirtyChange?.(snapshot!==initial.current),[snapshot,onDirtyChange]);

  const save=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;setError('');
    try{
      const parsed=parseEnergy(calories,energyUnit);
      if(!Number.isFinite(parsed))throw new Error(`Enter calories in ${energyLabel(energyUnit)}.`);
      await run(()=>store.mutate({kind:'entry',recordId:crypto.randomUUID(),expectedRevision:0,delete:false,data:{date,time,name:'Quick add',calories:parsed,quantity:1,unit:'serving',portionLabel:null,portionGrams:null,protein:null,fat:null,carbs:null,fiber:null,source:'Quick add'}}));
      onDone();
    }catch(ex){setError((ex as Error).message);}
  };

  return <div className="dialog-step editor"><Form onSubmit={save}>
    {onBack&&<div style={{marginBottom: 12}}>
      <Button type="button" variant="tertiary" size="sm" className="subpage-back-button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true"/>Back
      </Button>
    </div>}
    <Field id="quick-add-calories" name="calories" data-modal-autofocus label={`Calories (${energyLabel(energyUnit)})`} type="number" min="0" max={energyUnit==='kj'?83680:20000} step="any" required value={calories} onChange={event=>setCalories(event.target.value)}/>
    <TimePicker id="quick-add-time" name="time" label="Meal time" required value={time} onChange={setTime}/>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="modal-actions">
      {onBack&&<Button type="button" variant="secondary" onClick={onBack}>Back</Button>}
      <Button type="submit" variant="primary" disabled={busy}>{busy?'Saving…':'Add calories'}</Button>
    </div>
  </Form></div>;
}

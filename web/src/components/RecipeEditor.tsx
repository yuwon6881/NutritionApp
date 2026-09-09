import {Form,FieldFrame} from './ui/Form';
import {useEffect,useRef,useState} from 'react';
import type {Food} from '../types';
import type {Nourish} from '../useNourish';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';

export function RecipeEditor({store,onClose,onDirtyChange}:{store:Nourish;onClose:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
  const foods=store.state!.foods.filter(food=>!food.deleted);
  const [name,setName]=useState('');
  const [yieldGrams,setYield]=useState(500);
  const [items,setItems]=useState<{food:Food;grams:number}[]>([]);
  const [selected,setSelected]=useState(foods[0]?.id??'');
  const [grams,setGrams]=useState(100);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const initial=useRef(JSON.stringify({name:'',yieldGrams:500,items:[],selected:foods[0]?.id??'',grams:100}));
  const snapshot=JSON.stringify({name,yieldGrams,items,selected,grams});

  useEffect(()=>onDirtyChange?.(snapshot!==initial.current),[snapshot,onDirtyChange]);

  const save=async()=>{
    setBusy(true);setError('');
    try{
      const nutrient=(key:'calories'|'protein'|'fat'|'carbs'|'fiber')=>items.some(item=>item.food[key]==null)?null:items.reduce((sum,item)=>sum+item.food[key]!*item.grams/100,0)/yieldGrams*100;
      await store.mutate({kind:'food',recordId:crypto.randomUUID(),expectedRevision:0,delete:false,data:{name,calories:nutrient('calories'),protein:nutrient('protein'),fat:nutrient('fat'),carbs:nutrient('carbs'),fiber:nutrient('fiber'),source:'Personal recipe',servingGrams:100,cookedYieldGrams:yieldGrams,ingredientsJson:JSON.stringify(items),favourite:true}});
      onClose();
    }catch(ex){setError((ex as Error).message);}finally{setBusy(false);}
  };

  return <div className="dialog-step recipe-editor">
    <p>Saved food values are per 100 g.</p>

    <Form onSubmit={()=>{const food=foods.find(item=>item.id===selected);if(food)setItems(current=>[...current,{food,grams}]);}}>
    <div className="form-grid">
      <SelectField id="recipe-ingredient" name="ingredient" label="Ingredient" value={selected} onChange={setSelected}>{foods.map(food=><option key={food.id} value={food.id}>{food.name}</option>)}</SelectField>
      <Field id="recipe-ingredient-grams" name="grams" required label="Ingredient grams" type="number" min="1" value={grams} onChange={event=>setGrams(Number(event.target.value))}/>
    </div>
    <Button type="submit" disabled={!foods.length}>Add ingredient</Button>
    </Form>
    <Form onSubmit={()=>void save()}>
    <Field id="recipe-name" name="name" data-modal-autofocus label="Recipe name" required maxLength={160} value={name} onChange={event=>setName(event.target.value)}/>
    <FieldFrame label="Ingredients" validate={()=>!items.length?"Add at least one ingredient.":JSON.stringify(items).length>12000?"This recipe has too many ingredients. Remove an ingredient before saving.":undefined}>
    <p data-validation-focus tabIndex={-1}>Ingredients · {items.length}</p>
    <ul className="recipe-list">{items.map((item,index)=><li key={`${item.food.id}-${index}`}><span>{item.food.name} · {item.grams} g</span><Button type="button" variant="tertiary" aria-label={`Remove ingredient ${index+1}`} onClick={()=>setItems(current=>current.filter((_,itemIndex)=>itemIndex!==index))}>Remove</Button></li>)}</ul>
    </FieldFrame>
    <Field id="recipe-cooked-yield" name="yieldGrams" validate={()=>{for(const key of ['calories','protein','fat','carbs','fiber'] as const){if(items.some(item=>item.food[key]==null))continue;const value=items.reduce((sum,item)=>sum+item.food[key]!*item.grams/100,0)/yieldGrams*100;if(!Number.isFinite(value)||value>(key==='calories'?20000:3000))return 'Increase the yield or reduce ingredients to keep per-100 g nutrients within the supported range.';}return undefined;}} required label="Cooked yield (grams)" type="number" min="1" max="100000" value={yieldGrams} onChange={event=>setYield(Number(event.target.value))}/>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="modal-actions"><Button variant="primary" disabled={busy} type="submit">{busy?'Saving…':'Save recipe'}</Button></div>
    </Form>
  </div>;
}

import {Form,FieldFrame} from './ui/Form';
import {useEffect,useRef,useState} from 'react';
import type {Nutrients} from '../types';
import type {Nourish} from '../useNourish';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {api} from '../lib/api';
import {useAsyncAction} from './ui/useAsyncAction';

export function RecipeEditor({store,onClose,onDirtyChange}:{store:Nourish;onClose:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
  const foods=store.state!.foods.filter(food=>!food.deleted);
  const [name,setName]=useState('');
  const [yieldGrams,setYield]=useState(500);
  const [servings,setServings]=useState(4);
  const [items,setItems]=useState<{food:Nutrients;grams:number}[]>([]);
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<Nutrients[]>([]);
  const [selected,setSelected]=useState<Nutrients>();
  const [grams,setGrams]=useState(100);
  const [error,setError]=useState('');
  const {busy,run}=useAsyncAction();
  const initial=useRef(JSON.stringify({name:'',yieldGrams:500,servings:4,items:[],selected:undefined,grams:100}));
  const snapshot=JSON.stringify({name,yieldGrams,servings,items,selected,grams});

  useEffect(()=>onDirtyChange?.(snapshot!==initial.current),[snapshot,onDirtyChange]);

  const save=async()=>{
    if(busy)return;setError('');
    try{
      const nutrient=(key:'calories'|'protein'|'fat'|'carbs'|'fiber')=>items.some(item=>item.food[key]==null)?null:items.reduce((sum,item)=>sum+item.food[key]!*item.grams/100,0)/yieldGrams*100;
      await run(()=>store.mutate({kind:'food',recordId:crypto.randomUUID(),expectedRevision:0,delete:false,data:{name,calories:nutrient('calories'),protein:nutrient('protein'),fat:nutrient('fat'),carbs:nutrient('carbs'),fiber:nutrient('fiber'),source:'Personal recipe',servingGrams:100,portionsJson:JSON.stringify([{label:'serving',grams:yieldGrams/servings}]),cookedYieldGrams:yieldGrams,ingredientsJson:JSON.stringify(items),favourite:true}}));
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  return <div className="dialog-step recipe-editor">
    <Form onSubmit={()=>void run(async()=>{setError('');try{setResults(await api<Nutrients[]>('/foods/search?q='+encodeURIComponent(query)));}catch(ex){setError((ex as Error).message);}})}>
      <Field id="recipe-search" name="query" label="Search ingredients" required minLength={2} maxLength={100} value={query} onChange={event=>setQuery(event.target.value)} action={<Button type="submit" disabled={busy}>Search</Button>}/>
    </Form>
    <div className="recipe-search-results">{[...results,...foods.filter(food=>query.trim()&&food.name.toLowerCase().includes(query.toLowerCase()))].map((food,index)=><Button key={index} onClick={()=>{setSelected(food);setQuery('');setResults([]);}}>{food.name}</Button>)}</div>
    {selected&&<Form onSubmit={()=>{setItems(current=>[...current,{food:selected,grams}]);setSelected(undefined);setGrams(100);}}>
      <strong>{selected.name}</strong>
      <Field id="recipe-ingredient-grams" name="grams" required label="Ingredient grams" type="number" min="0.1" max="100000" step="any" value={grams} onChange={event=>setGrams(Number(event.target.value))}/>
      <Button type="submit">Add ingredient</Button>
    </Form>}
    <Form onSubmit={()=>void save()}>
    <Field id="recipe-name" name="name" data-modal-autofocus label="Recipe name" required maxLength={160} value={name} onChange={event=>setName(event.target.value)}/>
    <FieldFrame label="Ingredients" validate={()=>!items.length?"Add at least one ingredient.":JSON.stringify(items).length>12000?"This recipe has too many ingredients. Remove an ingredient before saving.":undefined}>
    <p data-validation-focus tabIndex={-1}>Ingredients · {items.length}</p>
    <ul className="recipe-list">{items.map((item,index)=><li key={`${item.food.name}-${index}`}><span>{item.food.name}</span><Field label={`Grams for ${item.food.name}`} type="number" min="0.1" max="100000" required step="any" value={item.grams} onChange={event=>setItems(current=>current.map((value,i)=>i===index?{...value,grams:Number(event.target.value)}:value))}/><Button type="button" variant="tertiary" aria-label={`Remove ingredient ${index+1}`} onClick={()=>setItems(current=>current.filter((_,itemIndex)=>itemIndex!==index))}>Remove</Button></li>)}</ul>
    </FieldFrame>
    <Field id="recipe-servings" name="servings" validate={()=>!Number.isFinite(servings)||servings<=0?'Enter a positive number of servings.':undefined} required label="Servings in cooked yield" type="number" min="0.1" max="10000" step="any" value={servings} onChange={event=>setServings(Number(event.target.value))}/>
    <Field id="recipe-cooked-yield" name="yieldGrams" validate={()=>{for(const key of ['calories','protein','fat','carbs','fiber'] as const){if(items.some(item=>item.food[key]==null))continue;const value=items.reduce((sum,item)=>sum+item.food[key]!*item.grams/100,0)/yieldGrams*100;if(!Number.isFinite(value)||value>(key==='calories'?20000:3000))return 'Increase the yield or reduce ingredients to keep per-100 g nutrients within the supported range.';}return undefined;}} required label="Cooked yield (grams)" type="number" min="1" max="100000" value={yieldGrams} onChange={event=>setYield(Number(event.target.value))}/>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="modal-actions"><Button variant="primary" disabled={busy} type="submit">{busy?'Saving…':'Save recipe'}</Button></div>
    </Form>
  </div>;
}

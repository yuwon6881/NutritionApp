import {Form,FieldFrame} from './ui/Form';
import {useState} from 'react';
import type {FoodSearchResult} from '../types';
import type {Nourish} from '../useNourish';
import {ArrowLeft} from 'lucide-react';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {useAsyncAction} from './ui/useAsyncAction';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {number} from '../lib/format';

export interface RecipeIngredient {
  food:FoodSearchResult;
  grams:number;
}

export interface RecipeDraft {
  name:string;
  yieldGrams:number;
  servings:number;
  items:RecipeIngredient[];
}

export interface RecipeQuantity {
  grams:number;
  selectedPortionLabel:string;
  portionMultiplier:number;
}

export const emptyRecipeDraft=():RecipeDraft=>({name:'',yieldGrams:500,servings:4,items:[]});
export const emptyRecipeQuantity=():RecipeQuantity=>({grams:100,selectedPortionLabel:'g',portionMultiplier:1});

function toIngredientFood(food:FoodSearchResult):FoodSearchResult {
  return {
    name: food.name,
    calories: food.calories,
    protein: food.protein,
    fat: food.fat,
    carbs: food.carbs,
    fiber: food.fiber,
    source: food.source,
    servingGrams: food.servingGrams || 100,
    portions: food.portions ?? [],
    code: food.code ?? null,
    basis: food.basis,
  };
}

export function RecipeEditor({
  store,
  draft,
  onDraftChange,
  selected,
  quantity,
  onQuantityChange,
  onAddIngredient,
  onBeginIngredient,
  onCancelIngredient,
  onClose,
  onSaved,
}: {
  store:Nourish;
  draft:RecipeDraft;
  onDraftChange:(draft:RecipeDraft)=>void;
  selected?:FoodSearchResult;
  quantity:RecipeQuantity;
  onQuantityChange:(quantity:RecipeQuantity)=>void;
  onAddIngredient:(food:FoodSearchResult,grams:number)=>void;
  onBeginIngredient:()=>void;
  onCancelIngredient:()=>void;
  onClose:()=>void;
  onSaved?:()=>void;
}){
  const energyUnit=unitsFor(store.state!.settings).energy;
  const {busy,run}=useAsyncAction();
  const [error,setError]=useState('');

  const save=async()=>{
    if(busy)return;
    setError('');
    try{
      const nutrient=(key:'calories'|'protein'|'fat'|'carbs'|'fiber')=>draft.items.some(item=>item.food[key]==null)?null:draft.items.reduce((sum,item)=>sum+item.food[key]!*item.grams/100,0)/draft.yieldGrams*100;
      await run(()=>store.mutate({
        kind:'food',
        recordId:crypto.randomUUID(),
        expectedRevision:0,
        delete:false,
        data:{
          name:draft.name,
          calories:nutrient('calories'),
          protein:nutrient('protein'),
          fat:nutrient('fat'),
          carbs:nutrient('carbs'),
          fiber:nutrient('fiber'),
          source:'Personal recipe',
          servingGrams:100,
          portionsJson:JSON.stringify([{label:'serving',grams:draft.yieldGrams/draft.servings}]),
          cookedYieldGrams:draft.yieldGrams,
          ingredientsJson:JSON.stringify(draft.items),
          favourite:true,
        }
      }));
      if(onSaved)onSaved();
      else onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  const totalNutrient=(key:'calories'|'protein'|'fat'|'carbs'|'fiber')=>{
    if(draft.items.some(item=>item.food[key]==null))return null;
    return draft.items.reduce((sum,item)=>sum+item.food[key]!*item.grams/100,0);
  };
  const totalCalories=totalNutrient('calories');
  const totalProtein=totalNutrient('protein');
  const totalCarbs=totalNutrient('carbs');
  const totalFat=totalNutrient('fat');
  const perServingCalories=totalCalories!=null&&draft.servings>0?totalCalories/draft.servings:null;
  const perServingProtein=totalProtein!=null&&draft.servings>0?totalProtein/draft.servings:null;
  const perServingCarbs=totalCarbs!=null&&draft.servings>0?totalCarbs/draft.servings:null;
  const perServingFat=totalFat!=null&&draft.servings>0?totalFat/draft.servings:null;
  const per100Calories=totalCalories!=null&&draft.yieldGrams>0?totalCalories/draft.yieldGrams*100:null;
  const per100Protein=totalProtein!=null&&draft.yieldGrams>0?totalProtein/draft.yieldGrams*100:null;
  const per100Carbs=totalCarbs!=null&&draft.yieldGrams>0?totalCarbs/draft.yieldGrams*100:null;
  const per100Fat=totalFat!=null&&draft.yieldGrams>0?totalFat/draft.yieldGrams*100:null;

  if(selected){
    const calc=(key:'calories'|'protein'|'fat'|'carbs'|'fiber')=>selected[key]==null?null:selected[key]! * quantity.grams / 100;
    const calcCalories=calc('calories')??0;
    const calcProtein=calc('protein');
    const calcCarbs=calc('carbs');
    const calcFat=calc('fat');
    const calcFiber=calc('fiber');
    return <div className="dialog-step recipe-quantity-step" aria-labelledby="recipe-quantity-title">
      <div className="section-heading">
        <div>
          <h3 id="recipe-quantity-title">Set ingredient quantity</h3>
          <p>{selected.name}</p>
        </div>
        <Button type="button" variant="tertiary" className="subpage-back-button" onClick={onCancelIngredient}>
          <ArrowLeft size={16} aria-hidden="true"/>Back to recipe
        </Button>
      </div>

      <div className="live-calorie-card" style={{margin:'12px 0 18px'}}>
        <div className="live-calorie-header">
          <span className="live-calorie-tag">INGREDIENT CONTRIBUTION</span>
          <div className="live-calorie-value">
            <strong>{displayEnergy(calcCalories,energyUnit)}</strong> <span className="unit">{energyLabel(energyUnit)}</span>
          </div>
        </div>
        <div className="live-calorie-meta">
          <span className="live-macros">
            Protein {number(calcProtein,1)} g · Carbs {number(calcCarbs,1)} g · Fat {number(calcFat,1)} g
            {calcFiber!=null?` · Fiber ${number(calcFiber,1)} g`:''}
          </span>
        </div>
      </div>

      <Form onSubmit={()=>onAddIngredient(toIngredientFood(selected),quantity.grams)}>
        {selected.portions&&selected.portions.length>0&&<div className="form-grid">
          <SelectField
            id="recipe-portion-select"
            name="portion"
            label="Serving portion"
            value={quantity.selectedPortionLabel}
            onChange={value=>{
              if(value==='g'){
                onQuantityChange({...quantity,selectedPortionLabel:value});
                return;
              }
              const portion=selected.portions?.find(item=>item.label===value);
              onQuantityChange({...quantity,selectedPortionLabel:value,grams:portion?Math.round(quantity.portionMultiplier*portion.grams*10)/10:quantity.grams});
            }}
            options={[{value:'g',label:'Custom grams (g)'},...selected.portions.map(portion=>({value:portion.label,label:`${portion.label} (${portion.grams} g)`}))]}
          />
          {quantity.selectedPortionLabel!=='g'&&<Field
            id="recipe-portion-multiplier"
            name="portionMultiplier"
            label="Number of servings"
            type="number"
            min="0.1"
            max="1000"
            step="any"
            value={quantity.portionMultiplier}
            onChange={event=>{
              const mult=Number(event.target.value);
              const portion=selected.portions?.find(item=>item.label===quantity.selectedPortionLabel);
              onQuantityChange({...quantity,portionMultiplier:mult,grams:portion&&mult>0?Math.round(mult*portion.grams*10)/10:quantity.grams});
            }}
          />}
        </div>}
        <Field
          id="recipe-ingredient-grams"
          name="grams"
          data-modal-autofocus
          required
          label="Ingredient grams"
          type="number"
          min="0.1"
          max="100000"
          step="any"
          value={quantity.grams}
          onChange={event=>onQuantityChange({...quantity,grams:Number(event.target.value),selectedPortionLabel:'g'})}
        />
        <Button variant="primary" type="submit">Add ingredient</Button>
      </Form>
    </div>;
  }

  return <div className="dialog-step recipe-editor">
    <div style={{marginBottom:12}}>
      <Button type="button" variant="tertiary" size="sm" className="subpage-back-button" onClick={onClose}>
        <ArrowLeft size={16} aria-hidden="true"/>Back
      </Button>
    </div>

    <Form onSubmit={()=>void save()}>
      <Field id="recipe-name" name="name" data-modal-autofocus label="Recipe name" required maxLength={160} value={draft.name} onChange={event=>onDraftChange({...draft,name:event.target.value})}/>
      <FieldFrame label="Ingredients" validate={()=>!draft.items.length?'Add at least one ingredient.':JSON.stringify(draft.items).length>12000?'This recipe has too many ingredients. Remove an ingredient before saving.':undefined}>
        <div className="recipe-ingredients-heading">
          <p data-validation-focus tabIndex={-1}>Ingredients · {draft.items.length}</p>
          <Button type="button" variant="secondary" onClick={onBeginIngredient}>Add ingredient</Button>
        </div>
        <ul className="recipe-list">
          {draft.items.map((item,index)=>{
            const itemCalories=item.food.calories!=null?Math.round(item.food.calories*item.grams/100):0;
            return <li key={`${item.food.name}-${index}`} className="recipe-ingredient-row">
              <div className="recipe-ingredient-info">
                <strong>{item.food.name}</strong>
                <small>
                  {displayEnergy(itemCalories,energyUnit)} {energyLabel(energyUnit)}
                  {item.food.protein!=null&&` · P ${number(item.food.protein*item.grams/100,1)}g`}
                  {item.food.carbs!=null&&` · C ${number(item.food.carbs*item.grams/100,1)}g`}
                  {item.food.fat!=null&&` · F ${number(item.food.fat*item.grams/100,1)}g`}
                </small>
              </div>
              <div className="recipe-ingredient-actions">
                <Field
                  label={`Grams for ${item.food.name}`}
                  type="number"
                  min="0.1"
                  max="100000"
                  required
                  step="any"
                  value={item.grams}
                  onChange={event=>onDraftChange({...draft,items:draft.items.map((value,itemIndex)=>itemIndex===index?{...value,grams:Number(event.target.value)}:value)})}
                />
                <Button type="button" variant="tertiary" aria-label={`Remove ingredient ${index+1}`} onClick={()=>onDraftChange({...draft,items:draft.items.filter((_,itemIndex)=>itemIndex!==index)})}>Remove</Button>
              </div>
            </li>;
          })}
        </ul>
      </FieldFrame>

      {draft.items.length>0&&<div className="recipe-nutrition-card panel card-tint">
        <div className="section-heading" style={{marginBottom:10}}>
          <div><h3>Recipe nutrition preview</h3><p>Based on {draft.items.length} {draft.items.length===1?'ingredient':'ingredients'} · {draft.yieldGrams} g cooked yield</p></div>
        </div>
        <div className="stats-grid" style={{marginBottom:10}}>
          <div className="stat-card"><span className="eyebrow">TOTAL BATCH</span><h2>{displayEnergy(totalCalories,energyUnit)} <small className="unit">{energyLabel(energyUnit)}</small></h2><p className="food-macro-summary" style={{margin:0}}><span className="food-macro protein"><b>P</b> {number(totalProtein,1)} g</span><span className="food-macro carbs"><b>C</b> {number(totalCarbs,1)} g</span><span className="food-macro fat"><b>F</b> {number(totalFat,1)} g</span></p></div>
          <div className="stat-card"><span className="eyebrow">PER SERVING ({draft.servings})</span><h2>{displayEnergy(perServingCalories,energyUnit)} <small className="unit">{energyLabel(energyUnit)}</small></h2><p className="food-macro-summary" style={{margin:0}}><span className="food-macro protein"><b>P</b> {number(perServingProtein,1)} g</span><span className="food-macro carbs"><b>C</b> {number(perServingCarbs,1)} g</span><span className="food-macro fat"><b>F</b> {number(perServingFat,1)} g</span></p></div>
          <div className="stat-card"><span className="eyebrow">PER 100 G COOKED</span><h2>{displayEnergy(per100Calories,energyUnit)} <small className="unit">{energyLabel(energyUnit)}</small></h2><p className="food-macro-summary" style={{margin:0}}><span className="food-macro protein"><b>P</b> {number(per100Protein,1)} g</span><span className="food-macro carbs"><b>C</b> {number(per100Carbs,1)} g</span><span className="food-macro fat"><b>F</b> {number(per100Fat,1)} g</span></p></div>
        </div>
      </div>}

      <Field id="recipe-servings" name="servings" validate={()=>!Number.isFinite(draft.servings)||draft.servings<=0?'Enter a positive number of servings.':undefined} required label="Servings in cooked yield" type="number" min="0.1" max="10000" step="any" value={draft.servings} onChange={event=>onDraftChange({...draft,servings:Number(event.target.value)})}/>
      <Field id="recipe-cooked-yield" name="yieldGrams" validate={()=>{for(const key of ['calories','protein','fat','carbs','fiber'] as const){if(draft.items.some(item=>item.food[key]==null))continue;const value=draft.items.reduce((sum,item)=>sum+item.food[key]!*item.grams/100,0)/draft.yieldGrams*100;if(!Number.isFinite(value)||value>(key==='calories'?20000:3000))return 'Increase the yield or reduce ingredients to keep per-100 g nutrients within the supported range.';}return undefined;}} required label="Cooked yield (grams)" type="number" min="1" max="100000" value={draft.yieldGrams} onChange={event=>onDraftChange({...draft,yieldGrams:Number(event.target.value)})}/>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Back</Button><Button variant="primary" disabled={busy} type="submit">{busy?'Saving…':'Save recipe'}</Button></div>
    </Form>
  </div>;
}

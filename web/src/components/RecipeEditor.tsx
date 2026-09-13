import {Form,FieldFrame} from './ui/Form';
import {useEffect,useRef,useState} from 'react';
import type {FoodSearchResult} from '../types';
import type {Nourish} from '../useNourish';
import {ArrowLeft,Camera,ScanBarcode,Search,Star} from 'lucide-react';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {BarcodeCamera} from './BarcodeCamera';
import {SegmentedControl} from './ui/SegmentedControl';
import {api} from '../lib/api';
import {useAsyncAction} from './ui/useAsyncAction';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {number} from '../lib/format';
import {parsePortions} from '../lib/portions';
import {nutritionSummary} from './FoodPicker';

function toIngredientFood(food: FoodSearchResult): FoodSearchResult {
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
  };
}

export function RecipeEditor({store,onClose,onDirtyChange}:{store:Nourish;onClose:()=>void;onDirtyChange?:(dirty:boolean)=>void}){
  const energyUnit = unitsFor(store.state!.settings).energy;
  const savedFoods: FoodSearchResult[] = store.state!.foods
    .filter(food => !food.deleted)
    .map(food => ({
      ...food,
      portions: parsePortions(food.portionsJson),
    }));

  const [name,setName]=useState('');
  const [yieldGrams,setYield]=useState(500);
  const [servings,setServings]=useState(4);
  const [items,setItems]=useState<{food:FoodSearchResult;grams:number}[]>([]);
  const [searchTab,setSearchTab]=useState<'search'|'saved'|'barcode'>('search');
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<FoodSearchResult[]>([]);
  const [selected,setSelected]=useState<FoodSearchResult>();
  const [ingredientStep,setIngredientStep]=useState<'recipe'|'quantity'>('recipe');
  const [grams,setGrams]=useState(100);
  const [selectedPortionLabel,setSelectedPortionLabel]=useState<string>('g');
  const [portionMultiplier,setPortionMultiplier]=useState<number>(1);
  const [camera,setCamera]=useState(false);
  const [error,setError]=useState('');
  const {busy,run}=useAsyncAction();

  const initial=useRef(JSON.stringify({name:'',yieldGrams:500,servings:4,items:[],selected:undefined,grams:100}));
  const snapshot=JSON.stringify({name,yieldGrams,servings,items,selected,grams});

  useEffect(()=>onDirtyChange?.(snapshot!==initial.current),[snapshot,onDirtyChange]);

  const selectFood = async (food: FoodSearchResult) => {
    let resolved = food;
    if (food.code && (!food.portions || food.portions.length === 0)) {
      try {
        resolved = await api<FoodSearchResult>('/foods/barcode/' + encodeURIComponent(food.code));
      } catch {
        // Fall back to original food if barcode lookup fails
      }
    }
    const initialGrams = resolved.servingGrams || resolved.portions?.[0]?.grams || 100;
    setSelected(resolved);
    setQuery('');
    setResults([]);
    setGrams(initialGrams);
    setSelectedPortionLabel('g');
    setPortionMultiplier(1);
    setCamera(false);
    setIngredientStep('quantity');
  };

  const executeSearch = async (term: string) => {
    setError('');
    try {
      const found = await api<FoodSearchResult[]>('/foods/search?q=' + encodeURIComponent(term));
      setResults(found);
    } catch (ex) {
      setError((ex as Error).message);
    }
  };

  const lookupBarcode = async (code: string) => {
    setError('');
    try {
      const found = await api<FoodSearchResult>('/foods/barcode/' + encodeURIComponent(code));
      await selectFood(found);
    } catch (ex) {
      setError((ex as Error).message);
    }
  };

  const save=async()=>{
    if(busy)return;setError('');
    try{
      const nutrient=(key:'calories'|'protein'|'fat'|'carbs'|'fiber')=>items.some(item=>item.food[key]==null)?null:items.reduce((sum,item)=>sum+item.food[key]!*item.grams/100,0)/yieldGrams*100;
      await run(()=>store.mutate({
        kind:'food',
        recordId:crypto.randomUUID(),
        expectedRevision:0,
        delete:false,
        data:{
          name,
          calories:nutrient('calories'),
          protein:nutrient('protein'),
          fat:nutrient('fat'),
          carbs:nutrient('carbs'),
          fiber:nutrient('fiber'),
          source:'Personal recipe',
          servingGrams:100,
          portionsJson:JSON.stringify([{label:'serving',grams:yieldGrams/servings}]),
          cookedYieldGrams:yieldGrams,
          ingredientsJson:JSON.stringify(items),
          favourite:true
        }
      }));
      onClose();
    }catch(ex){setError((ex as Error).message);}
  };

  // Live recipe calculations
  const totalNutrient = (key: 'calories'|'protein'|'fat'|'carbs'|'fiber') => {
    if (items.some(item => item.food[key] == null)) return null;
    return items.reduce((sum, item) => sum + item.food[key]! * item.grams / 100, 0);
  };
  const totalCalories = totalNutrient('calories');
  const totalProtein = totalNutrient('protein');
  const totalCarbs = totalNutrient('carbs');
  const totalFat = totalNutrient('fat');

  const perServingCalories = totalCalories != null && servings > 0 ? totalCalories / servings : null;
  const perServingProtein = totalProtein != null && servings > 0 ? totalProtein / servings : null;
  const perServingCarbs = totalCarbs != null && servings > 0 ? totalCarbs / servings : null;
  const perServingFat = totalFat != null && servings > 0 ? totalFat / servings : null;

  const per100Calories = totalCalories != null && yieldGrams > 0 ? (totalCalories / yieldGrams) * 100 : null;
  const per100Protein = totalProtein != null && yieldGrams > 0 ? (totalProtein / yieldGrams) * 100 : null;
  const per100Carbs = totalCarbs != null && yieldGrams > 0 ? (totalCarbs / yieldGrams) * 100 : null;
  const per100Fat = totalFat != null && yieldGrams > 0 ? (totalFat / yieldGrams) * 100 : null;

  // Live ingredient calculation for selected
  const calcNutrient = (key: 'calories'|'protein'|'fat'|'carbs'|'fiber') => {
    if (!selected || selected[key] == null) return null;
    return selected[key]! * grams / 100;
  };
  const calcCalories = calcNutrient('calories') ?? 0;
  const calcProtein = calcNutrient('protein');
  const calcCarbs = calcNutrient('carbs');
  const calcFat = calcNutrient('fat');
  const calcFiber = calcNutrient('fiber');

  const matchingSaved = query.trim()
    ? savedFoods.filter(food => food.name.toLowerCase().includes(query.toLowerCase()))
    : [];

  const combinedSearchResults = [
    ...results,
    ...matchingSaved.filter(saved => !results.some(r => r.name.toLowerCase() === saved.name.toLowerCase() && r.source === saved.source)),
  ];

  return <div className="dialog-step recipe-editor">
    {ingredientStep==='recipe'&&<div style={{marginBottom: 12}}>
      <Button type="button" variant="tertiary" size="sm" className="subpage-back-button" onClick={onClose}>
        <ArrowLeft size={16} aria-hidden="true"/>Back
      </Button>
    </div>}

    {ingredientStep==='recipe'&&<div className="recipe-ingredient-search-section">
      <SegmentedControl
        layout="equal"
        className="section-segments"
        label="Ingredient source"
        value={searchTab}
        options={[
          {value:'search',label:<><Search size={16}/><span>Search</span></>,ariaLabel:'Search'},
          {value:'saved',label:<><Star size={16}/><span className="tab-label-full">Your foods</span><span className="tab-label-short">Saved</span></>,ariaLabel:'Your foods'},
          {value:'barcode',label:<><ScanBarcode size={16}/><span className="tab-label-full">Barcode</span><span className="tab-label-short">Scan</span></>,ariaLabel:'Barcode'},
        ]}
        onChange={val => {
          setSearchTab(val as 'search'|'saved'|'barcode');
          setCamera(false);
          setError('');
        }}
      />

      {searchTab === 'search' && (
        <Form onSubmit={()=>void run(()=>executeSearch(query))}>
          <Field
            id="recipe-search"
            name="query"
            label="Search ingredients"
            required
            minLength={2}
            maxLength={100}
            value={query}
            onChange={event=>setQuery(event.target.value)}
            action={<Button type="submit" disabled={busy}>{busy?'Searching…':'Search'}</Button>}
          />
        </Form>
      )}

      {searchTab === 'barcode' && (
        <>
          <Form onSubmit={event => {
            event.preventDefault();
            if (/^[0-9]{8,14}$/.test(query.trim())) {
              void run(() => lookupBarcode(query.trim()));
            }
          }}>
            <div className="search-line">
              <Field
                id="recipe-barcode-search"
                name="barcode"
                label="Barcode digits"
                inputMode="numeric"
                required
                validate={()=>!/^[0-9]{8,14}$/.test(query.trim())?'Enter an 8–14 digit barcode.':undefined}
                value={query}
                onChange={event=>setQuery(event.target.value)}
                action={<Button type="submit" disabled={busy}>{busy?'Looking up…':'Look up'}</Button>}
              />
            </div>
          </Form>
          <div className="barcode-scan-options" style={{margin: '8px 0 12px'}}>
            <Button variant="primary" onClick={()=>setCamera(value=>!value)}>
              <Camera size={18}/>{camera?'Stop camera':'Scan barcode with camera'}
            </Button>
          </div>
          {camera && (
            <section className="barcode-scanner-step" aria-labelledby="recipe-barcode-scanner-title">
              <div className="section-heading">
                <div>
                  <h3 id="recipe-barcode-scanner-title">Barcode scanner</h3>
                  <p>Scan a packaged food barcode to add as ingredient.</p>
                </div>
                <Button variant="tertiary" onClick={()=>setCamera(false)}>Done scanning</Button>
              </div>
              <BarcodeCamera
                onDetected={code => {
                  setCamera(false);
                  setQuery(code);
                  void run(() => lookupBarcode(code));
                }}
                onError={message => {
                  setError(message);
                  setCamera(false);
                }}
              />
            </section>
          )}
        </>
      )}

      {searchTab === 'saved' && (
        <div className="recipe-saved-foods-list">
          {savedFoods.length === 0 ? (
            <p className="empty">No saved foods in your library yet.</p>
          ) : (
            <div className="recipe-search-results">
              {savedFoods.map((food, index) => (
                <div key={`${food.source}|${food.name}|${index}`} className="food-row interactive recipe-result-row">
                  <div className="food-description">
                    <Button
                      type="button"
                      variant="tertiary"
                      className="recipe-result-choose-btn"
                      aria-label={food.name}
                      onClick={()=>void selectFood(food)}
                    >
                      {food.name}
                    </Button>
                    <small>{nutritionSummary(food, energyUnit)} · {food.source}</small>
                    <div className="food-macro-summary" style={{margin: '4px 0 0'}}>
                      <span className="food-macro protein"><b>P</b> {number(food.protein, 1)} g</span>
                      <span className="food-macro carbs"><b>C</b> {number(food.carbs, 1)} g</span>
                      <span className="food-macro fat"><b>F</b> {number(food.fat, 1)} g</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Select ${food.name}`}
                    onClick={()=>void selectFood(food)}
                  >
                    Select
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {searchTab === 'search' && combinedSearchResults.length > 0 && (
        <div className="recipe-search-results">
          {combinedSearchResults.map((food, index) => (
            <div key={`${food.source}|${food.name}|${index}`} className="food-row interactive recipe-result-row">
              <div className="food-description">
                <Button
                  type="button"
                  variant="tertiary"
                  className="recipe-result-choose-btn"
                  aria-label={food.name}
                  onClick={()=>void selectFood(food)}
                >
                  {food.name}
                </Button>
                <small>{nutritionSummary(food, energyUnit)} · {food.source}</small>
                <div className="food-macro-summary" style={{margin: '4px 0 0'}}>
                  <span className="food-macro protein"><b>P</b> {number(food.protein, 1)} g</span>
                  <span className="food-macro carbs"><b>C</b> {number(food.carbs, 1)} g</span>
                  <span className="food-macro fat"><b>F</b> {number(food.fat, 1)} g</span>
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={`Select ${food.name}`}
                onClick={()=>void selectFood(food)}
              >
                Select
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>}

    {ingredientStep==='quantity'&&selected&&<section className="recipe-quantity-step" aria-labelledby="recipe-quantity-title">
      <div className="section-heading">
        <div>
          <h3 id="recipe-quantity-title">Set ingredient quantity</h3>
          <p>{selected.name}</p>
        </div>
        <Button type="button" variant="tertiary" className="subpage-back-button" onClick={()=>{setSelected(undefined);setIngredientStep('recipe');}}>
          <ArrowLeft size={16} aria-hidden="true"/>Back to recipe
        </Button>
      </div>

      <div className="live-calorie-card" style={{margin: '12px 0 18px'}}>
        <div className="live-calorie-header">
          <span className="live-calorie-tag">INGREDIENT CONTRIBUTION</span>
          <div className="live-calorie-value">
            <strong>{displayEnergy(calcCalories, energyUnit)}</strong> <span className="unit">{energyLabel(energyUnit)}</span>
          </div>
        </div>
        <div className="live-calorie-meta">
          <span className="live-macros">
            Protein {number(calcProtein, 1)} g · Carbs {number(calcCarbs, 1)} g · Fat {number(calcFat, 1)} g
            {calcFiber != null ? ` · Fiber ${number(calcFiber, 1)} g` : ''}
          </span>
        </div>
      </div>

      <Form onSubmit={()=>{
        setItems(current=>[...current,{food:toIngredientFood(selected),grams}]);
        setSelected(undefined);
        setGrams(100);
        setIngredientStep('recipe');
      }}>
        {selected.portions && selected.portions.length > 0 && (
          <div className="form-grid">
            <SelectField
              id="recipe-portion-select"
              name="portion"
              label="Serving portion"
              value={selectedPortionLabel}
              onChange={val => {
                setSelectedPortionLabel(val);
                if (val === 'g') {
                  // Keep current grams
                } else {
                  const portion = selected.portions?.find(p => p.label === val);
                  if (portion) {
                    setGrams(Math.round(portionMultiplier * portion.grams * 10) / 10);
                  }
                }
              }}
              options={[
                {value: 'g', label: 'Custom grams (g)'},
                ...selected.portions.map(p => ({
                  value: p.label,
                  label: `${p.label} (${p.grams} g)`,
                })),
              ]}
            />
            {selectedPortionLabel !== 'g' && (
              <Field
                id="recipe-portion-multiplier"
                name="portionMultiplier"
                label="Number of servings"
                type="number"
                min="0.1"
                max="1000"
                step="any"
                value={portionMultiplier}
                onChange={event => {
                  const mult = Number(event.target.value);
                  setPortionMultiplier(mult);
                  const portion = selected.portions?.find(p => p.label === selectedPortionLabel);
                  if (portion && mult > 0) {
                    setGrams(Math.round(mult * portion.grams * 10) / 10);
                  }
                }}
              />
            )}
          </div>
        )}
        <Field
          id="recipe-ingredient-grams"
          name="grams"
          required
          label="Ingredient grams"
          type="number"
          min="0.1"
          max="100000"
          step="any"
          value={grams}
          onChange={event=>setGrams(Number(event.target.value))}
        />
        <Button variant="primary" type="submit">Add ingredient</Button>
      </Form>
    </section>}

    {ingredientStep==='recipe'&&<Form onSubmit={()=>void save()}>
      <Field id="recipe-name" name="name" data-modal-autofocus label="Recipe name" required maxLength={160} value={name} onChange={event=>setName(event.target.value)}/>
      <FieldFrame label="Ingredients" validate={()=>!items.length?"Add at least one ingredient.":JSON.stringify(items).length>12000?"This recipe has too many ingredients. Remove an ingredient before saving.":undefined}>
        <p data-validation-focus tabIndex={-1}>Ingredients · {items.length}</p>
        <ul className="recipe-list">
          {items.map((item,index)=>{
            const itemCalories = item.food.calories != null ? Math.round(item.food.calories * item.grams / 100) : 0;
            return (
              <li key={`${item.food.name}-${index}`} className="recipe-ingredient-row">
                <div className="recipe-ingredient-info">
                  <strong>{item.food.name}</strong>
                  <small>
                    {displayEnergy(itemCalories, energyUnit)} {energyLabel(energyUnit)}
                    {item.food.protein != null && ` · P ${number(item.food.protein * item.grams / 100, 1)}g`}
                    {item.food.carbs != null && ` · C ${number(item.food.carbs * item.grams / 100, 1)}g`}
                    {item.food.fat != null && ` · F ${number(item.food.fat * item.grams / 100, 1)}g`}
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
                    onChange={event=>setItems(current=>current.map((value,i)=>i===index?{...value,grams:Number(event.target.value)}:value))}
                  />
                  <Button
                    type="button"
                    variant="tertiary"
                    aria-label={`Remove ingredient ${index+1}`}
                    onClick={()=>setItems(current=>current.filter((_,itemIndex)=>itemIndex!==index))}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </FieldFrame>

      {items.length > 0 && (
        <div className="recipe-nutrition-card panel card-tint">
          <div className="section-heading" style={{marginBottom: 10}}>
            <div>
              <h3>Recipe nutrition preview</h3>
              <p>Based on {items.length} {items.length===1?'ingredient':'ingredients'} · {yieldGrams} g cooked yield</p>
            </div>
          </div>
          <div className="stats-grid" style={{marginBottom: 10}}>
            <div className="stat-card">
              <span className="eyebrow">TOTAL BATCH</span>
              <h2>{displayEnergy(totalCalories, energyUnit)} <small className="unit">{energyLabel(energyUnit)}</small></h2>
              <p className="food-macro-summary" style={{margin: 0}}>
                <span className="food-macro protein"><b>P</b> {number(totalProtein, 1)} g</span>
                <span className="food-macro carbs"><b>C</b> {number(totalCarbs, 1)} g</span>
                <span className="food-macro fat"><b>F</b> {number(totalFat, 1)} g</span>
              </p>
            </div>
            <div className="stat-card">
              <span className="eyebrow">PER SERVING ({servings})</span>
              <h2>{displayEnergy(perServingCalories, energyUnit)} <small className="unit">{energyLabel(energyUnit)}</small></h2>
              <p className="food-macro-summary" style={{margin: 0}}>
                <span className="food-macro protein"><b>P</b> {number(perServingProtein, 1)} g</span>
                <span className="food-macro carbs"><b>C</b> {number(perServingCarbs, 1)} g</span>
                <span className="food-macro fat"><b>F</b> {number(perServingFat, 1)} g</span>
              </p>
            </div>
            <div className="stat-card">
              <span className="eyebrow">PER 100 G COOKED</span>
              <h2>{displayEnergy(per100Calories, energyUnit)} <small className="unit">{energyLabel(energyUnit)}</small></h2>
              <p className="food-macro-summary" style={{margin: 0}}>
                <span className="food-macro protein"><b>P</b> {number(per100Protein, 1)} g</span>
                <span className="food-macro carbs"><b>C</b> {number(per100Carbs, 1)} g</span>
                <span className="food-macro fat"><b>F</b> {number(per100Fat, 1)} g</span>
              </p>
            </div>
          </div>
        </div>
      )}

      <Field id="recipe-servings" name="servings" validate={()=>!Number.isFinite(servings)||servings<=0?'Enter a positive number of servings.':undefined} required label="Servings in cooked yield" type="number" min="0.1" max="10000" step="any" value={servings} onChange={event=>setServings(Number(event.target.value))}/>
      <Field id="recipe-cooked-yield" name="yieldGrams" validate={()=>{for(const key of ['calories','protein','fat','carbs','fiber'] as const){if(items.some(item=>item.food[key]==null))continue;const value=items.reduce((sum,item)=>sum+item.food[key]!*item.grams/100,0)/yieldGrams*100;if(!Number.isFinite(value)||value>(key==='calories'?20000:3000))return 'Increase the yield or reduce ingredients to keep per-100 g nutrients within the supported range.';}return undefined;}} required label="Cooked yield (grams)" type="number" min="1" max="100000" value={yieldGrams} onChange={event=>setYield(Number(event.target.value))}/>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>Back</Button>
        <Button variant="primary" disabled={busy} type="submit">{busy?'Saving…':'Save recipe'}</Button>
      </div>
    </Form>}
  </div>;
}

import {useState,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import {number} from '../lib/format';
import {mealTime} from '../lib/foodDiary';
import {basketTotals,basketEntries} from '../lib/foodBasket';
import type {FoodBasketHook} from '../useFoodBasket';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {Form,FieldFrame} from './ui/Form';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';

export interface FoodBasketProps {
  basket:FoodBasketHook;
  store:Nourish;
  date:string;
  onBack:()=>void;
  onSaved:()=>void;
}

export function FoodBasket({
  basket,
  store,
  date,
  onBack,
  onSaved,
}:FoodBasketProps){
  const [meal,setMeal]=useState('Meal');
  const [time,setTime]=useState(()=>mealTime(store.state!.profile?.timeZone));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [announcement,setAnnouncement]=useState('');
  const units=unitsFor(store.state!.settings);

  const totals=basketTotals(basket.lines);

  const partials=(['protein','carbs','fat','fiber'] as const)
    .filter(k=>totals[k].partial)
    .map(k=>({nutrient:k==='fiber'?'fibre':k,known:totals[k].known,total:totals[k].total}));

  const submitBatch=async(event:FormEvent)=>{
    event.preventDefault();
    if(!basket.lines.length||basket.lines.length>20)return;
    setBusy(true);
    setError('');
    try{
      const entries=basketEntries(basket.lines,{date,time,meal});
      await store.logEntries(entries);
      for(const scanId of basket.scanIds){
        await store.removeScan(scanId);
      }
      basket.clear();
      onSaved();
    }catch(ex){
      setError((ex as Error).message);
    }finally{
      setBusy(false);
    }
  };

  return <div className="dialog-step food-basket">
    {announcement&&<p role="status" style={{position:'absolute',width:1,height:1,padding:0,margin:-1,overflow:'hidden',clip:'rect(0,0,0,0)',whiteSpace:'nowrap',border:0}}>{announcement}</p>}
    <div className="live-calorie-card">
      <div className="live-calorie-header">
        <span className="live-calorie-tag">BATCH TOTAL</span>
        <div className="live-calorie-value">
          <strong>{displayEnergy(totals.calories,units.energy)}</strong> <span className="unit">{energyLabel(units.energy)}</span>
        </div>
      </div>
      <div className="live-calorie-meta">
        <span className="live-delta">{totals.count} {totals.count===1?'food':'foods'}</span>
        <span className="live-macros">
          Protein {number(totals.protein.value)} g{totals.protein.partial?' · partial':''} · 
          Carbs {number(totals.carbs.value)} g{totals.carbs.partial?' · partial':''} · 
          Fat {number(totals.fat.value)} g{totals.fat.partial?' · partial':''} · 
          Fibre {number(totals.fiber.value)} g{totals.fiber.partial?' · partial':''}
        </span>
      </div>
      {partials.map(p=><small key={p.nutrient} style={{display:'block',marginTop:4}}>
        {p.known} of {p.total} foods report {p.nutrient}.
      </small>)}
    </div>

    <Form onSubmit={submitBatch}>
      <div className="form-grid">
        <Field id="batch-meal" name="meal" label="Meal" required maxLength={80} value={meal} onChange={event=>setMeal(event.target.value)}/>
        <Field id="batch-time" name="time" label="Meal time" type="time" required value={time} onChange={event=>setTime(event.target.value)}/>
      </div>

      <FieldFrame
        label="Batch foods"
        validate={()=>!basket.lines.length
          ?'Add at least one food.'
          :basket.lines.length>20
          ?'You can log up to 20 foods in one batch. Remove a food before continuing.'
          :undefined}
      >
        <p data-validation-focus tabIndex={-1} className="eyebrow" style={{marginBottom:12}}>
          BATCH FOODS ({basket.lines.length})
        </p>

        {basket.lines.map(line=><fieldset key={line.key}>
          <legend>{line.name}</legend>
          <div className="form-grid">
            <Field
              id={`basket-qty-${line.key}`}
              name={`qty_${line.key}`}
              label={`Quantity (${line.unit})`}
              type="number"
              min="0.001"
              max="100000"
              step="any"
              required
              value={line.quantity}
              onChange={event=>basket.updateLineQuantity(line.key,Number(event.target.value))}
            />
            <SelectField
              id={`basket-unit-${line.key}`}
              name={`unit_${line.key}`}
              label="Quantity unit"
              value={line.unit}
              onChange={value=>basket.updateLineUnit(line.key,value as 'g'|'serving')}
            >
              <option value="g">Grams</option>
              <option value="serving">Servings</option>
            </SelectField>
          </div>
          <p style={{fontSize:'.84rem',margin:'8px 0'}}>
            {displayEnergy(line.calories,units.energy)} {energyLabel(units.energy)} ·
            P: {number(line.protein)} g · 
            C: {number(line.carbs)} g · 
            Fat: {number(line.fat)} g · 
            Fibre: {number(line.fiber)} g
          </p>
          <p className="source">Source: {line.source}</p>
          <Button
            type="button"
            variant="tertiary"
            aria-label={`Remove ${line.name}`}
            onClick={()=>{
              basket.removeLine(line.key);
              setAnnouncement(`Removed ${line.name} from batch.`);
            }}
          >
            Remove {line.name}
          </Button>
        </fieldset>)}
      </FieldFrame>

      {error&&<p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>Back to search</Button>
        <Button type="submit" variant="primary" disabled={busy||!basket.lines.length}>
          {busy?'Logging…':`Log all ${basket.lines.length} foods`}
        </Button>
      </div>
    </Form>
  </div>;
}

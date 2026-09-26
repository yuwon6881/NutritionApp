import {useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import {ScanBarcode} from 'lucide-react';
import type {Nourish} from '../useNourish';
import {number} from '../lib/format';
import {mealTime} from '../lib/foodDiary';
import {basketTotals,basketEntries} from '../lib/foodBasket';
import type {FoodBasketHook} from '../useFoodBasket';
import {BatchFoodRow} from './BatchFoodRow';
import {Button} from './ui/Button';
import {TimePicker} from './ui/Field';
import {Form,FieldFrame} from './ui/Form';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {FoodEditor} from './FoodEditor';
import {parsePortions} from '../lib/portions';
import {useAsyncAction} from './ui/useAsyncAction';

export interface FoodBasketProps {
  basket:FoodBasketHook;
  store:Nourish;
  date:string;
  onBack:()=>void;
  onSaved:()=>void;
  initialTime?:string;
  onTimeChange?:(time:string)=>void;
  /** Offered after a barcode item so a pantry of packages can be scanned one after another. */
  onScanAnother?:()=>void;
}

export function FoodBasket({
  basket,
  store,
  date,
  onBack,
  onSaved,
  initialTime,
  onTimeChange,
  onScanAnother,
}:FoodBasketProps){
  const [time,setTime]=useState(initialTime??(()=>mealTime(store.state!.profile?.timeZone)));
  const {busy,run}=useAsyncAction();
  const [error,setError]=useState('');
  const [announcement,setAnnouncement]=useState('');
  const [editingKey,setEditingKey]=useState<string>();
  const [actionsKey,setActionsKey]=useState<string>();
  const root=useRef<HTMLDivElement>(null);
  const previousEditing=useRef<string|undefined>(undefined);
  useLayoutEffect(()=>{
    const target=editingKey?root.current?.querySelector<HTMLElement>('[data-modal-autofocus]'):previousEditing.current?Array.from(root.current?.querySelectorAll<HTMLElement>('[data-batch-actions]')??[]).find(element=>element.dataset.batchActions===previousEditing.current&&element.getClientRects().length>0):undefined;
    previousEditing.current=editingKey;
    if(!target)return;
    const frame=requestAnimationFrame(()=>target.focus({preventScroll:true}));
    return()=>cancelAnimationFrame(frame);
  },[editingKey]);
  const units=unitsFor(store.state!.settings);

  const totals=basketTotals(basket.lines);

  const partials=(['protein','carbs','fat'] as const)
    .filter(k=>totals[k].partial)
    .map(k=>({nutrient:k,known:totals[k].known,total:totals[k].total}));

  const submitBatch=async(event:FormEvent)=>{
    event.preventDefault();
    if(!basket.lines.length||basket.lines.length>20)return;
    setError('');
    try{
      await run(async()=>{
        const entries=basketEntries(basket.lines,{date,time});
        await basket.flush();
        await store.logEntries(entries,{retireFoodBasketDate:date});
        basket.clearAfterOutboxCommit();
      });
      onSaved();
    }catch(ex){setError((ex as Error).message);}
  };

  const editing=basket.lines.find(line=>line.key===editingKey);
  if(editing)return <div ref={root}><FoodEditor initial={editing} title="Edit batch food" energyUnit={units.energy} onClose={()=>setEditingKey(undefined)} onSave={async data=>{await basket.replaceLine(editing.key,{...editing,...data,portions:parsePortions(data.portionsJson)});setEditingKey(undefined);}}/></div>;
  return <div ref={root} className="dialog-step food-basket">
    {announcement&&<p role="status" className="sr-only">{announcement}</p>}
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
          Fat {number(totals.fat.value)} g{totals.fat.partial?' · partial':''}
        </span>
      </div>
      {partials.map(p=><small key={p.nutrient}>
        {p.known} of {p.total} foods report {p.nutrient}.
      </small>)}
    </div>

    <Form onSubmit={submitBatch}>
      <TimePicker id="batch-time" name="time" label="Meal time" required dataModalAutofocus value={time} onChange={value=>{setTime(value);onTimeChange?.(value);}}/>

      <FieldFrame
        label="Batch foods"
        validate={()=>!basket.lines.length
          ?'Add at least one food.'
          :basket.lines.length>20
          ?'You can log up to 20 foods in one batch. Remove a food before continuing.'
          :undefined}
      >
        <p data-validation-focus tabIndex={-1} className="eyebrow food-basket-eyebrow">
          BATCH FOODS ({basket.lines.length})
        </p>

        <div className="batch-food-list">
          {basket.lines.map(line=><BatchFoodRow key={line.key} line={line} energyUnit={units.energy} open={actionsKey===line.key} onOpen={open=>setActionsKey(open?line.key:undefined)} onEdit={()=>setEditingKey(line.key)} onRemove={()=>{void basket.removeLine(line.key).then(()=>{setActionsKey(undefined);setAnnouncement('Removed '+line.name+' from batch.');}).catch(()=>setActionsKey(undefined));}}/>)}
        </div>
      </FieldFrame>

      {error&&<p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>Add more food</Button>
        {onScanAnother&&<Button type="button" variant="secondary" onClick={onScanAnother} disabled={busy}><ScanBarcode size={17} aria-hidden="true"/>Scan another</Button>}
        <Button type="submit" variant="primary" data-step-focus disabled={busy||!basket.lines.length}>
          {busy?'Logging…':`Log all ${basket.lines.length} ${basket.lines.length===1?'food':'foods'}`}
        </Button>
      </div>
    </Form>
  </div>;
}

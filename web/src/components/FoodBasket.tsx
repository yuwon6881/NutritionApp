import {useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import type {Nourish} from '../useNourish';
import {number} from '../lib/format';
import {mealTime} from '../lib/foodDiary';
import {basketTotals,basketEntries} from '../lib/foodBasket';
import type {FoodBasketHook} from '../useFoodBasket';
import {Button} from './ui/Button';
import {TimePicker} from './ui/Field';
import {Form,FieldFrame} from './ui/Form';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {displayPortion} from '../lib/portions';
import {FoodEditor} from './FoodEditor';
import {parsePortions} from '../lib/portions';
import {SwipeableRow} from './ui/SwipeableRow';
import {useAsyncAction} from './ui/useAsyncAction';

const MACROS=[
  {key:'protein',label:'Protein',short:'P'},
  {key:'carbs',label:'Carbs',short:'C'},
  {key:'fat',label:'Fat',short:'F'},
  {key:'fiber',label:'Fibre',short:'Fib'},
] as const;

export interface FoodBasketProps {
  basket:FoodBasketHook;
  store:Nourish;
  date:string;
  onBack:()=>void;
  onSaved:()=>void;
  initialTime?:string;
  onTimeChange?:(time:string)=>void;
}

export function FoodBasket({
  basket,
  store,
  date,
  onBack,
  onSaved,
  initialTime,
  onTimeChange,
}:FoodBasketProps){
  const [time,setTime]=useState(initialTime??(()=>mealTime(store.state!.profile?.timeZone)));
  const {busy,run}=useAsyncAction();
  const [error,setError]=useState('');
  const [announcement,setAnnouncement]=useState('');
  const [editingKey,setEditingKey]=useState<string>();
  const [actionsKey,setActionsKey]=useState<string>();
  const [touchStart,setTouchStart]=useState<{x:number;y:number}>();
  const root=useRef<HTMLDivElement>(null);
  const previousEditing=useRef<string|undefined>(undefined);
  useLayoutEffect(()=>{
    const target=editingKey?root.current?.querySelector<HTMLElement>('[data-modal-autofocus]'):previousEditing.current?Array.from(root.current?.querySelectorAll<HTMLElement>('[data-batch-actions]')??[]).find(element=>element.dataset.batchActions===previousEditing.current):undefined;
    previousEditing.current=editingKey;
    if(!target)return;
    const frame=requestAnimationFrame(()=>target.focus({preventScroll:true}));
    return()=>cancelAnimationFrame(frame);
  },[editingKey]);
  const units=unitsFor(store.state!.settings);

  const totals=basketTotals(basket.lines);

  const partials=(['protein','carbs','fat','fiber'] as const)
    .filter(k=>totals[k].partial)
    .map(k=>({nutrient:k==='fiber'?'fibre':k,known:totals[k].known,total:totals[k].total}));

  const submitBatch=async(event:FormEvent)=>{
    event.preventDefault();
    if(!basket.lines.length||basket.lines.length>20)return;
    setError('');
    try{
      await run(async()=>{
        const entries=basketEntries(basket.lines,{date,time});
        await store.logEntries(entries);
        for(const scanId of basket.scanIds){
          await store.removeScan(scanId);
        }
        basket.clear();
      });
      onSaved();
    }catch(ex){setError((ex as Error).message);}
  };

  const editing=basket.lines.find(line=>line.key===editingKey);
  if(editing)return <div ref={root}><FoodEditor initial={editing} title="Edit batch food" energyUnit={units.energy} onClose={()=>setEditingKey(undefined)} onSave={async data=>{basket.replaceLine(editing.key,{...editing,...data,portions:parsePortions(data.portionsJson)});setEditingKey(undefined);}}/></div>;
  return <div ref={root} className="dialog-step food-basket">
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

    {basket.scanIds.map(id=>store.local?.scans.find(scan=>scan.id===id)).filter(scan=>scan?.result).map(scan=><details key={scan!.id} className="source"><summary>AI estimate notes</summary>{scan!.result!.questions.map((question,index)=><p key={index}>{question}</p>)}{scan!.result!.foods.filter(food=>food.notes).map((food,index)=><p key={index}>{food.name}: {food.notes}</p>)}</details>)}
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
        <p data-validation-focus tabIndex={-1} className="eyebrow" style={{marginBottom:12}}>
          BATCH FOODS ({basket.lines.length})
        </p>

        {basket.lines.map(line=><SwipeableRow
          key={line.key}
          className="batch-food"
          actionsLabel={'Actions for '+line.name}
          actionsWidth={148}
          actions={<>
            <Button type="button" data-batch-actions={line.key} aria-label={'Edit '+line.name} onClick={()=>setEditingKey(line.key)}>Edit</Button>
            <Button type="button" variant="destructive" aria-label={'Remove '+line.name} onClick={()=>{basket.removeLine(line.key);setAnnouncement('Removed '+line.name+' from batch.');}}>Remove</Button>
          </>}
        >
          <div className="batch-food-body">
            <div className="batch-food-summary">
              <div><strong>{line.name}</strong><small>{displayPortion(line)}{line.source.startsWith('AI')?' · AI estimate':''}</small></div>
              <span className="batch-food-energy">{displayEnergy(line.calories,units.energy)} <small>{energyLabel(units.energy)}</small></span>
            </div>
            {/* Each food reports its own macros, not just the batch total. An
                absent nutrient stays absent rather than reading as zero. */}
            <dl className="batch-food-macros">
              {MACROS.map(macro=><div key={macro.key}>
                <dt><span className="macro-name-full">{macro.label}</span><span className="macro-name-short">{macro.short}</span></dt>
                <dd>{number(line[macro.key],1)} g</dd>
              </div>)}
            </dl>
          </div>
        </SwipeableRow>)}
      </FieldFrame>

      {error&&<p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>Add more food</Button>
        <Button type="submit" variant="primary" disabled={busy||!basket.lines.length}>
          {busy?'Logging…':`Log all ${basket.lines.length} ${basket.lines.length===1?'food':'foods'}`}
        </Button>
      </div>
    </Form>
  </div>;
}

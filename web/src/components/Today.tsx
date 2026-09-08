import {useEffect,useState} from 'react';
import {ArrowRight,Plus,Trash2,Copy,Check,Leaf,Scale,Compass} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {CoachResult,Entry} from '../types';
import {number,today} from '../lib/format';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {DatePicker} from './ui/DatePicker';
import {Card} from './ui/Card';

export function Today({
  store,
  date,
  setDate,
  onLog,
  onCoach,
  onEdit,
  openWeight
}:{
  store:Nourish;
  date:string;
  setDate:(v:string)=>void;
  onLog:()=>void;
  onCoach:()=>void;
  onEdit:(e:Entry)=>void;
  openWeight?:boolean;
}){
  const state=store.state!;
  const [error,setError]=useState('');
  const [copyDate,setCopyDate]=useState(date);
  const [showQuickWeight,setShowQuickWeight]=useState(openWeight??false);
  const [quickKg,setQuickKg]=useState('');
  const [quickWeightDate,setQuickWeightDate]=useState(date);

  useEffect(()=>{if(openWeight)setShowQuickWeight(true);},[openWeight]);

  const entries=state.entries.filter(e=>!e.deleted&&e.date===date);
  const savedDay=state.days.find(d=>d.date===date&&!d.deleted);
  const total=savedDay?.archived?(savedDay.calories??0):entries.reduce((s,e)=>s+e.calories,0);
  const readOnly=date<(state.detailCutoff??"2000-01-01");
  const accepted=state.plans.find(p=>!p.deleted&&p.profileRevision===state.profileRevision);
  const plan:CoachResult|undefined=accepted?JSON.parse(accepted.resultJson):undefined;
  const day=state.days.find(d=>d.date===date);
  const status=day&&!day.deleted?day.status:'incomplete';
  const ratio=plan?.calories?Math.min(total/plan.calories,1):0;
  const act=async(fn:()=>Promise<unknown>)=>{try{setError('');await fn();}catch(ex){setError((ex as Error).message);}};
  const loaded=date>=state.start&&date<=state.end;

  return <>
    <header className="page-heading">
      <div>
        <p className="eyebrow">ONE DAY AT A TIME</p>
        <h1>Your daily picture</h1>
        <p>Make room for good food. We’ll help with the numbers.</p>
      </div>
      <DatePicker label="Diary date" value={date} max={today(state.profile?.timeZone)} onChange={val=>{
        setDate(val);
        if(val<state.start||val>state.end)void store.refresh(val).catch(ex=>setError(ex.message));
      }}/>
    </header>

    {!loaded?<section className="panel">
      <h2>This date isn’t stored on this device yet</h2>
      <p>Connect to load its history before adding or editing entries.</p>
    </section>:<>
      <section className="daily-grid">
        <article className="panel energy-panel">
          <div>
            <p className="eyebrow">TODAY’S ENERGY</p>
            <h2>{number(total)} <span className="unit">kcal logged</span></h2>
            <p>{plan?.calories?`${number(plan.calories)} kcal daily target`:'Your coaching target starts with a profile.'}</p>
            <Button variant="tertiary" onClick={onCoach}>
              {plan?'View your plan':'Set up your coach'}<ArrowRight size={16}/>
            </Button>
          </div>
          <svg className="energy-ring" viewBox="0 0 120 120" role="img" aria-label={plan?.calories?`${number(total)} of ${number(plan.calories)} calories logged`:`${number(total)} calories logged`}>
            <circle className="ring-track" cx="60" cy="60" r="48"/>
            <circle className="ring-fill" cx="60" cy="60" r="48" strokeDasharray={`${ratio*301.59} 301.59`} transform="rotate(-90 60 60)"/>
            <text x="60" y="58" textAnchor="middle">{plan?.calories?number(Math.max(plan.calories-total,0)):'—'}</text>
            <text className="ring-label" x="60" y="76" textAnchor="middle">{total>(plan?.calories??Infinity)?'target reached':'remaining'}</text>
          </svg>
        </article>

        <article className="panel macros">
          <p className="eyebrow">THE BUILDING BLOCKS</p>
          {(['protein','carbs','fat'] as const).map(key=>{
            const known=entries.filter(e=>e[key]!=null);
            const sum=savedDay?.archived?(savedDay[key]??0):known.reduce((s,e)=>s+e[key]!,0);
            const incomplete=savedDay?.archived?savedDay[key]==null:known.length!==entries.length;
            return <div className={'macro '+key} key={key}>
              <span>{key==='carbs'?'Carbohydrate':key[0].toUpperCase()+key.slice(1)}</span>
              <strong>{savedDay?.archived&&savedDay[key]==null?'—':entries.length&&!known.length?'—':number(sum)}<small> / {number(plan?.[key])} g{incomplete?' · partial':''}</small></strong>
              <progress aria-label={`${key} logged`} value={sum} max={Math.max(plan?.[key]??sum,1)}/>
            </div>;
          })}
        </article>
      </section>

      <div className="quick-actions-bar" role="group" aria-label="Quick mobile actions">
        <Button variant="primary" className="quick-action-btn" onClick={onLog} disabled={readOnly}>
          <Plus size={18}/>
          <span>Log food</span>
        </Button>
        <Button variant="secondary" className="quick-action-btn" onClick={()=>{setQuickWeightDate(date);setShowQuickWeight(s=>!s);}}>
          <Scale size={18}/>
          <span>{showQuickWeight?'Close weight':'Log weight'}</span>
        </Button>
        <Button variant="tertiary" className="quick-action-btn" onClick={onCoach}>
          <Compass size={18}/>
          <span>Coach targets</span>
        </Button>
      </div>

      {showQuickWeight&&<section className="panel quick-weight-panel" aria-label="Quick weight entry">
        <div className="section-heading">
          <div>
            <h2>Log today’s weigh-in</h2>
            <p>Consistent morning weigh-ins help calibrate your energy estimate.</p>
          </div>
          <Button variant="tertiary" onClick={()=>setShowQuickWeight(false)}>Close</Button>
        </div>
        <form onSubmit={async e=>{
          e.preventDefault();
          const weights=state.weights.filter(w=>!w.deleted);
          const old=weights.find(w=>w.date===quickWeightDate);
          await act(async()=>{
            await store.mutate({
              kind:'weight',
              recordId:old?.id??crypto.randomUUID(),
              expectedRevision:old?.revision??0,
              data:{date:quickWeightDate,kg:Number(quickKg)},
              delete:false
            });
            setQuickKg('');
            setShowQuickWeight(false);
          });
        }}>
          <div className="form-grid">
            <DatePicker label="Weigh-in date" value={quickWeightDate} max={today(state.profile?.timeZone)} required onChange={setQuickWeightDate}/>
            <Field label="Weight (kg)" type="number" min="20" max="400" step="0.01" required placeholder="e.g. 78.5" value={quickKg} onChange={e=>setQuickKg(e.target.value)}/>
          </div>
          <div className="actions">
            <Button variant="primary" size="md" type="submit" disabled={!quickKg}>Save weigh-in</Button>
          </div>
        </form>
      </section>}

      <section className="panel diary">
        <div className="section-heading">
          <div>
            <h2>{savedDay?.archived?"Your daily summary":"On your plate"}</h2>
            <p>{entries.length?`${entries.length} food entries · no good or bad labels`:'Start with your first meal or a quick calorie entry.'}</p>
          </div>
          <Button variant="primary" size="md" disabled={readOnly} onClick={onLog}>
            <Plus size={18}/>Log food
          </Button>
        </div>

        {savedDay?.archived?<div className="notice">
          <h3>{number(savedDay.calories)} kcal · {savedDay.entryCount} food entries</h3>
          <p>Meal details were compacted after {state.detailDays??7} days. Daily totals and logging completeness are kept for long-term progress and coaching.</p>
        </div>:!entries.length?<div className="empty">
          <Leaf size={30}/>
          <h3>A fresh page for today</h3>
          <p>Find a food, describe your meal, or take a photo.</p>
          <Button size="md" onClick={onLog}>Add your first food<ArrowRight size={16}/></Button>
        </div>:entries.map(entry=><div className="food-row" key={entry.id}>
          <div className="food-initial">{entry.name.slice(0,1)}</div>
          <div className="food-description">
            <Button variant="tertiary" disabled={readOnly} onClick={()=>onEdit(entry)}>{entry.name}</Button>
            <small>{entry.meal} · {number(entry.quantity,1)} {entry.unit} · {entry.source}</small>
            {store.local?.queue.some(q=>q.recordId===entry.id)&&<small className="sync-label">Pending sync</small>}
          </div>
          <strong>{number(entry.calories)}<small> kcal</small></strong>
          <Button variant="tertiary" aria-label={`Copy ${entry.name}`} onClick={()=>void act(()=>store.mutate({kind:'entry',recordId:crypto.randomUUID(),expectedRevision:0,data:{...entry,date},delete:false}))}>
            <Copy size={16}/>
          </Button>
          <Button variant="tertiary" disabled={readOnly} aria-label={`Delete ${entry.name}`} onClick={()=>void act(()=>store.mutate({kind:'entry',recordId:entry.id,expectedRevision:entry.revision,data:entry,delete:true}))}>
            <Trash2 size={16}/>
          </Button>
        </div>)}

        {!!entries.length&&<div className="copy-day">
          <DatePicker label="Copy this day to" value={copyDate} max={today(state.profile?.timeZone)} onChange={setCopyDate}/>
          <Button size="md" onClick={()=>void act(async()=>{
            for(const e of entries)await store.mutate({kind:'entry',recordId:crypto.randomUUID(),expectedRevision:0,data:{...e,date:copyDate},delete:false});
          })}>
            <Copy size={16}/>Copy day
          </Button>
        </div>}
      </section>

      {!readOnly&&<section className="panel completeness">
        <div>
          <h2>{status==='complete'?'Day marked complete':status==='fasting'?'Fasting day confirmed':'Is everything logged?'}</h2>
          <p>A complete day helps your coach learn. Missing meals are never counted as zero.</p>
        </div>
        <div className="actions completeness-actions">
          {(['incomplete','complete','fasting'] as const).map(s=><Button
            key={s}
            size="md"
            variant={status===s?'primary':'secondary'}
            disabled={status===s||(s==='fasting'&&total>0)}
            onClick={()=>void act(()=>store.mutate({kind:'day',recordId:day?.id??crypto.randomUUID(),expectedRevision:day?.revision??0,data:{date,status:s},delete:false}))}
          >
            {status===s&&<Check size={16}/>}
            {s==='complete'?'Complete':s==='fasting'?'Fasting':'Still logging'}
          </Button>)}
        </div>
      </section>}
    </>}
    {error&&<p className="error" role="alert">{error}</p>}
  </>;
}

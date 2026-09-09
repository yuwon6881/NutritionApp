import {useState} from 'react';
import {ChevronLeft,ChevronRight,Plus,Trash2} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Entry} from '../types';
import {useHistoryWindow} from '../useHistoryWindow';
import {number,today} from '../lib/format';
import {shiftDate} from '../lib/energyBalance';
import {dayStatus} from '../lib/loggingDay';
import {mealReadOnly,timelineGroups} from '../lib/foodDiary';
import {Button} from './ui/Button';
import {DatePicker} from './ui/DatePicker';
import {SelectField} from './ui/Field';

export function FoodDiary({store,date,setDate,onLog,onEdit}:{store:Nourish;date:string;setDate:(date:string)=>void;onLog:()=>void;onEdit:(entry:Entry)=>void}){
  const history=useHistoryWindow(store,date);
  const [error,setError]=useState('');
  const current=today(store.state!.profile?.timeZone);
  const currentUncached=!history.state&&date===current;
  const state=history.state??(currentUncached?store.state:undefined);
  const entries=state?.entries.filter(e=>!e.deleted&&e.date===date)??[];
  const day=state?.days.find(d=>d.date===date);
  const archived=!!day?.archived;
  const readOnly=!state||mealReadOnly(state,date);
  const count=archived?day?.entryCount??0:entries.length;
  const total=archived?day?.calories??0:entries.reduce((sum,e)=>sum+e.calories,0);
  const status=dayStatus(date,current,day&&!day.deleted?day.status:undefined,count>0);
  const act=async(action:()=>Promise<unknown>)=>{setError('');try{await action();}catch(ex){setError((ex as Error).message);}};
  const changeDate=(value:string)=>{if(value>='2000-01-01'&&value<=current){setError('');setDate(value);}};
  return <>
    <header className="page-heading"><h1>Food</h1><Button variant="primary" disabled={readOnly} onClick={onLog}><Plus size={18}/>Log food</Button></header>
    <div className="food-date-navigation">
      <Button aria-label="Previous food day" disabled={date<='2000-01-01'} onClick={()=>changeDate(shiftDate(date,-1))}><ChevronLeft size={18}/></Button>
      <DatePicker label="Food date" value={date} min="2000-01-01" max={current} onChange={changeDate}/>
      <Button aria-label="Next food day" disabled={date>=current} onClick={()=>changeDate(shiftDate(date,1))}><ChevronRight size={18}/></Button>
      <Button onClick={()=>changeDate(current)} disabled={date===current}>Today</Button>
    </div>
    {history.error&&<div className="notice" role="status">{state?'Saved history shown.':'This day is not available on this device. Connect to load its history.'} {history.error} <Button onClick={history.retry}>Retry history</Button></div>}
    {currentUncached&&<p className="notice" role="status">Only entries saved on this device are shown. Other entries will load when connected. You can keep logging today.</p>}
    {!state&&!history.error&&<p role="status">Loading food history…</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {state&&<>
      <section className="panel food-day-summary">
        <div className="section-heading"><div><h2>{date===current?'Today':date===shiftDate(current,-1)?'Yesterday':date}</h2><p>{status==='complete'?'Complete':status==='fasting'?'Fasting':status==='not_logged'?'Not logging':date===current?'Still logging':'No food logged'}</p></div>
          <strong className="figure-inline">{count||status==='fasting'?number(total):'—'} <span className="unit">kcal</span></strong>
        </div>
        <dl className="food-day-nutrients">{(['protein','carbs','fat','fiber'] as const).map(key=>{
          const known=entries.filter(e=>e[key]!=null);
          const value=archived?day?.[key]:known.length?known.reduce((sum,e)=>sum+e[key]!,0):null;
          const partial=!archived&&known.length>0&&known.length<entries.length;
          return <div key={key}><dt>{key[0].toUpperCase()+key.slice(1)}</dt><dd>{number(value)} g{partial?' · partial':''}</dd></div>;
        })}</dl>
        {date<current&&<SelectField label="Logging status" value={status==='fasting'||status==='not_logged'?status:'incomplete'} onChange={value=>void act(()=>store.mutate({kind:'day',recordId:day?.id??crypto.randomUUID(),expectedRevision:day?.revision??0,data:{date,status:value},delete:false}))}>
          <option value="incomplete">{count?'Complete automatically':'No food logged'}</option><option value="not_logged">Not logging</option><option value="fasting" disabled={total>0}>Fasting</option>
        </SelectField>}
      </section>
      {readOnly?<section className="panel"><h2>Daily summary</h2><p>{count} food {count===1?'entry':'entries'}{count?` · ${number(total)} kcal`:''}</p><p>Individual food details are no longer available. Detailed food history is kept for {state.detailDays??90} calendar days; previously summarized days remain read-only.</p></section>:<>
        {!entries.length&&<p className="empty">{currentUncached?'No food entries saved on this device for today.':status==='fasting'?'This day is marked as fasting.':status==='not_logged'?'This day is marked as not logging.':'No food entries for this day.'}</p>}
        <ol className="food-timeline" aria-label={`Food timeline for ${date}`}>
          {timelineGroups(entries).map(group=><li className="food-time-row" key={group.time}>
            <div className="food-time-label">{group.time?<time dateTime={`${date}T${group.time}`}>{group.label}</time>:group.label}</div>
            <div className="food-time-cards">{group.entries.map(entry=>{
              const pending=store.local!.queue.filter(op=>op.kind==='entry'&&op.recordId===entry.id);
              return <article className="panel food-time-card" key={entry.id}>
                <div className="section-heading"><h3><Button variant="tertiary" onClick={()=>onEdit(entry)}>{entry.name}</Button></h3><strong>{number(entry.calories)} <small>kcal</small></strong></div>
                <p>{entry.meal} · {number(entry.quantity,1)} {entry.unit}</p>
                <dl className="food-card-nutrients">{(['protein','carbs','fat','fiber'] as const).filter(key=>entry[key]!=null).map(key=><div key={key}><dt>{key[0].toUpperCase()+key.slice(1)}</dt><dd>{number(entry[key])} g</dd></div>)}</dl>
                <div className="food-card-footer"><small className="source">{entry.source}</small><Button variant="tertiary" aria-label={`Delete ${entry.name}`} onClick={()=>void act(()=>store.mutate({kind:'entry',recordId:entry.id,expectedRevision:entry.revision,data:entry,delete:true}))}><Trash2 size={17}/></Button></div>
                {pending.length>0&&<small className="sync-label" role="status">{pending.find(op=>op.error)?.error??'Saved on this device · pending sync'}</small>}
              </article>;
            })}</div>
          </li>)}
        </ol>
      </>}
    </>}
  </>;
}

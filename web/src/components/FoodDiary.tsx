import {useState} from 'react';
import {ChevronLeft,ChevronRight,Plus} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Entry} from '../types';
import {useHistoryWindow} from '../useHistoryWindow';
import {number,today} from '../lib/format';
import {shiftDate} from '../lib/energyBalance';
import {dayStatus} from '../lib/loggingDay';
import {mealReadOnly,moveEntry,type TimelineView} from '../lib/foodDiary';
import {Button} from './ui/Button';
import {DatePicker} from './ui/DatePicker';
import {SelectField} from './ui/Field';
import {FoodTimeline} from './FoodTimeline';
import {SegmentedControl} from './ui/SegmentedControl';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';

export function FoodDiary({store,date,setDate,onLog,onEdit}:{store:Nourish;date:string;setDate:(date:string)=>void;onLog:(time?:string)=>void;onEdit:(entry:Entry)=>void}){
  const history=useHistoryWindow(store,date);
  const [error,setError]=useState('');
  const [timelineView,setTimelineView]=useState<TimelineView>('data');
  const current=today(store.state!.profile?.timeZone);
  const currentUncached=!history.state&&date===current;
  const state=history.state??(currentUncached?store.state:undefined);
  const entries=state?.entries.filter(e=>!e.deleted&&e.date===date)??[];
  const day=state?.days.find(d=>d.date===date);
  const archived=!!day?.archived;
  const readOnly=!state||mealReadOnly(state,date);
  const count=archived?day?.entryCount??0:entries.length;
  const total=archived?day?.calories??0:entries.reduce((sum,e)=>sum+e.calories,0);
  const energyUnit=unitsFor(store.state?.settings).energy;
  const status=dayStatus(date,current,day&&!day.deleted?day.status:undefined,count>0);
  const act=async(action:()=>Promise<unknown>,rethrow=false)=>{setError('');try{await action();}catch(ex){setError((ex as Error).message);if(rethrow)throw ex;}};
  const changeDate=(value:string)=>{if(value>='2000-01-01'&&value<=current){setError('');setDate(value);}};
  const move=async(moving:Entry[],time:string)=>{await act(async()=>{for(const entry of moving){const operation=moveEntry(entry,time);if(operation)await store.mutate(operation);}},true);};
  return <div className="food-log-page">
    <header className="page-heading"><div><h1 data-page-heading tabIndex={-1}>Food Log</h1><p>Review entries by time and move them between hours.</p></div><Button variant="primary" disabled={readOnly} onClick={()=>onLog()}><Plus size={18}/>Log food</Button></header>
    <div className="food-date-navigation">
      <Button aria-label="Previous food day" disabled={date<='2000-01-01'} onClick={()=>changeDate(shiftDate(date,-1))}><ChevronLeft size={18}/></Button>
      <DatePicker label="Food date" value={date} min="2000-01-01" max={current} onChange={changeDate}/>
      <Button aria-label="Next food day" disabled={date>=current} onClick={()=>changeDate(shiftDate(date,1))}><ChevronRight size={18}/></Button>
      <Button onClick={()=>changeDate(current)} disabled={date===current}>Today</Button>
    </div>
    {history.error&&<div className="notice" role="status">{state?'Saved history shown.':'This day is not available on this device. Connect to load its history.'} {history.error} <Button onClick={history.retry}>Retry history</Button></div>}
    {history.loading&&<p className="notice loading-status" role="status" aria-busy="true">Loading food history…</p>}
    {currentUncached&&!history.loading&&<p className="notice" role="status">Only entries saved on this device are shown. Other entries will load when connected. You can keep logging today.</p>}
    {!state&&!history.loading&&!history.error&&<p className="loading-status" role="status">Loading food history…</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {state&&<>
      <section className="panel food-day-summary">
        <div className="section-heading"><div><h2>{date===current?'Today':date===shiftDate(current,-1)?'Yesterday':date}</h2><p>{status==='complete'?'Complete':status==='fasting'?'Fasting':status==='not_logged'?'Not logging':date===current?'Still logging':'No food logged'}</p></div>
          <strong className="figure-inline">{count||status==='fasting'?displayEnergy(total,energyUnit):'—'} <span className="unit">{energyLabel(energyUnit)}</span></strong>
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
      {readOnly?<section className="panel"><h2>Daily summary</h2><p>{count} food {count===1?'entry':'entries'}{count?` · ${displayEnergy(total,energyUnit)} ${energyLabel(energyUnit)}`:''}</p><p>Individual food details are no longer available. Detailed food history is kept for {state.detailDays??90} calendar days; previously summarized days remain read-only.</p></section>:<>
        <div className="food-timeline-toolbar">
          <div><h2>Food timeline</h2><p>Show only logged times or every hour from 12 AM through 11 PM.</p></div>
          <SegmentedControl<TimelineView> id="food-timeline-view" label="Food timeline hours" value={timelineView} onChange={setTimelineView} options={[{value:'data',label:'Hours with data'},{value:'full',label:'Full day'}]}/>
        </div>
        {!entries.length&&<p className="empty">{currentUncached?'No food entries saved on this device for today.':status==='fasting'?'This day is marked as fasting.':status==='not_logged'?'This day is marked as not logging.':'No food entries for this day.'}</p>}
        <FoodTimeline
          store={store}
          date={date}
          entries={entries}
          readOnly={readOnly}
          onEdit={onEdit}
          onMove={move}
          showEmptySlots
          timelineView={timelineView}
          onAddAtTime={readOnly?undefined:onLog}
        />
      </>}
    </>}
  </div>;
}

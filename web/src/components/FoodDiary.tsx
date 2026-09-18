import {useState} from 'react';
import {CheckCheck,ChevronLeft,ChevronRight,Plus} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Entry} from '../types';
import {useHistoryWindow} from '../useHistoryWindow';
import {number,today} from '../lib/format';
import {shiftDate} from '../lib/energyBalance';
import {dayStatus} from '../lib/loggingDay';
import {mealReadOnly,moveEntry,timelineSlots,type TimelineView} from '../lib/foodDiary';
import {Button} from './ui/Button';
import {DatePicker} from './ui/DatePicker';
import {SelectField} from './ui/Field';
import {FoodTimeline} from './FoodTimeline';
import {SegmentedControl} from './ui/SegmentedControl';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {CardFeedback} from './ui/CardFeedback';
import {useFoodSelection} from '../lib/useFoodSelection';
import {useFoodClipboard,createPasteMutations} from '../lib/useFoodClipboard';
import {FoodSelectionBar} from './FoodSelectionBar';
import {BulkDeleteFoodDialog} from './BulkDeleteFoodDialog';
import {FoodClipboardBanner} from './FoodClipboardBanner';
import {MoveFoodDialog} from './MoveFoodDialog';

export function FoodDiary({store,date,setDate,onLog,onEdit,onCopyDay}:{store:Nourish;date:string;setDate:(date:string)=>void;onLog:(time?:string)=>void;onEdit:(entry:Entry)=>void;onCopyDay:(date:string,entries:Entry[],trigger:HTMLElement)=>void}){
  const history=useHistoryWindow(store,date);
  const [error,setError]=useState('');
  const [timelineView,setTimelineView]=useState<TimelineView>('data');
  const [bulkDeleting,setBulkDeleting]=useState<Entry[]|null>(null);
  const [bulkMoving,setBulkMoving]=useState<Entry[]|null>(null);
  const [selectionRestoreFocus,setSelectionRestoreFocus]=useState<HTMLElement|null>(null);

  const selection=useFoodSelection();
  const clipboard=useFoodClipboard();

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
  const changeDate=(value:string)=>{if(value>='2000-01-01'&&value<=current){setError('');selection.exitSelection();setDate(value);}};

  const move=async(moving:Entry[],destinationDate:string,time?:string|null)=>{
    await act(async()=>{
      for(const entry of moving){
        const targetTime=time!==undefined?time:(entry.time??null);
        const operation=moveEntry(entry,targetTime,destinationDate);
        if(operation)await store.mutate(operation);
      }
    },true);
  };

  const copy=async(entry:Entry,destinationDate:string,time:string|null)=>{await act(()=>store.mutate({kind:'entry',recordId:crypto.randomUUID(),expectedRevision:0,delete:false,data:{...entry,date:destinationDate,time}}),true);};
  const remove=async(entry:Entry)=>{await act(()=>store.mutate({kind:'entry',recordId:entry.id,expectedRevision:entry.revision,delete:true,data:entry}),true);};

  const selectedEntries=entries.filter(e=>selection.isSelected(e.id));
  const selectedCalories=selectedEntries.reduce((sum,e)=>sum+e.calories,0);
  const groups=timelineSlots(entries,0,23,timelineView);

  const handleBulkDelete=async(deleting:Entry[])=>{
    await act(async()=>{
      for(const entry of deleting){
        await store.mutate({kind:'entry',recordId:entry.id,expectedRevision:entry.revision,delete:true,data:entry});
      }
      selection.exitSelection();
      setBulkDeleting(null);
    },true);
  };

  const handlePasteAtTime=async(time:string)=>{
    if(!clipboard.clipboard)return;
    await act(async()=>{
      const mutations=createPasteMutations(clipboard.clipboard!.entries,date,time);
      for(const m of mutations){
        await store.mutate(m);
      }
    },true);
  };

  const handlePasteToDay=async()=>{
    if(!clipboard.clipboard)return;
    await act(async()=>{
      const mutations=createPasteMutations(clipboard.clipboard!.entries,date);
      for(const m of mutations){
        await store.mutate(m);
      }
    },true);
  };

  return <div className="food-log-page">
    <header className="page-heading">
      <div><h1 data-page-heading tabIndex={-1}>Food Log</h1><p>Review entries by time, copy or move them, and remove mistakes.</p></div>
      <div className="page-heading-actions">
        {entries.length>0&&!readOnly&&<Button
          variant="tertiary"
          aria-label={selection.isSelecting?'Done selecting':'Select food entries'}
          onClick={()=>selection.isSelecting?selection.exitSelection():selection.enterSelection()}
        >
          <CheckCheck size={18}/>
          {selection.isSelecting?'Done':'Select'}
        </Button>}
        {entries.length>0&&!readOnly&&!selection.isSelecting&&<Button variant="tertiary" onClick={event=>onCopyDay(date,entries,event.currentTarget)}>Copy day</Button>}
        <Button variant="primary" disabled={readOnly} onClick={()=>onLog()}><Plus size={18}/>Log food</Button>
      </div>
    </header>
    <div className="food-diary-toolbar">
      <div className="food-date-navigation">
        <Button aria-label="Previous food day" disabled={date<='2000-01-01'} onClick={()=>changeDate(shiftDate(date,-1))}><ChevronLeft size={18}/></Button>
        <DatePicker label="Food date" value={date} min="2000-01-01" max={current} onChange={changeDate}/>
        <Button aria-label="Next food day" disabled={date>=current} onClick={()=>changeDate(shiftDate(date,1))}><ChevronRight size={18}/></Button>
        <Button onClick={()=>changeDate(current)} disabled={date===current}>Today</Button>
      </div>
      {date<current&&<div className="food-diary-toolbar-right">
        <SelectField label="Logging status" value={status==='fasting'||status==='not_logged'?status:'incomplete'} onChange={value=>void act(()=>store.mutate({kind:'day',recordId:day?.id??crypto.randomUUID(),expectedRevision:day?.revision??0,data:{date,status:value},delete:false}))}>
          <option value="incomplete">{count?'Complete automatically':'No food logged'}</option><option value="not_logged">Not logging</option><option value="fasting" disabled={total>0}>Fasting</option>
        </SelectField>
      </div>}
    </div>
    {history.error&&<CardFeedback
      title={state?'Diary history needs attention':'Diary history unavailable'}
      message={`${state?'Saved history shown.':'This day is not available on this device. Connect to load its history.'} ${history.error}`}
      action={{label:'Retry history',onClick:history.retry}}
    />}
    {currentUncached&&<p className="notice" role="status">Only entries saved on this device are shown. Other entries will load when connected. You can keep logging today.</p>}
    {!state&&!history.error&&<section className="panel food-day-summary skeleton" aria-busy="true">
      <div className="section-heading"><div><h2>{date===current?'Today':date===shiftDate(current,-1)?'Yesterday':date}</h2><p>Loading diary date…</p></div></div>
    </section>}
    {error&&<CardFeedback title="Diary action failed" message={error}/>}
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
      </section>
      {readOnly?<section className="panel"><h2>Daily summary</h2><p>{count} food {count===1?'entry':'entries'}{count?` · ${displayEnergy(total,energyUnit)} ${energyLabel(energyUnit)}`:''}</p><p>Individual food details are no longer available. Detailed food history is kept for {state.detailDays??90} calendar days; previously summarized days remain read-only.</p></section>:<>
        {clipboard.clipboard&&<FoodClipboardBanner
          clipboard={clipboard.clipboard}
          currentDate={current}
          viewDate={date}
          energyUnit={energyUnit}
          onPasteToDay={()=>void handlePasteToDay()}
          onClear={clipboard.clear}
        />}
        <div className="food-timeline-toolbar">
          <div><h2>Food timeline</h2><p>Show only logged times or every hour from 12 AM through 11 PM.</p></div>
          <SegmentedControl<TimelineView> id="food-timeline-view" label="Food timeline hours" value={timelineView} onChange={setTimelineView} options={[{value:'data',label:'Hours with data'},{value:'full',label:'Full day'}]}/>
        </div>
        {!entries.length&&timelineView==='data'&&<p className="empty">{currentUncached?'No food entries saved on this device for today.':status==='fasting'?'This day is marked as fasting.':status==='not_logged'?'This day is marked as not logging.':'No food entries for this day.'}</p>}
        <FoodTimeline
          store={store}
          date={date}
          currentDate={current}
          entries={entries}
          readOnly={readOnly}
          onEdit={onEdit}
          onMove={move}
          onCopy={copy}
          onDelete={remove}
          showEmptySlots
          timelineView={timelineView}
          onAddAtTime={readOnly?undefined:onLog}
          isSelecting={selection.isSelecting}
          selectedIds={selection.selectedIds}
          onToggleSelect={selection.toggle}
          onLongPressSelect={id=>selection.enterSelection(id)}
          clipboardCount={clipboard.count}
          onPasteAtTime={readOnly?undefined:handlePasteAtTime}
        />
      </>}
    </>}
    {selection.isSelecting&&<FoodSelectionBar
      selectedCount={selectedEntries.length}
      totalCount={entries.length}
      totalCalories={selectedCalories}
      energyUnit={energyUnit}
      onSelectAll={()=>selection.selectAll(entries.map(e=>e.id))}
      onDeselectAll={selection.deselectAll}
      onCopy={()=>{
        clipboard.copy(selectedEntries,date);
        selection.exitSelection();
      }}
      onMove={trigger=>{
        setSelectionRestoreFocus(trigger);
        setBulkMoving(selectedEntries);
      }}
      onDelete={trigger=>{
        setSelectionRestoreFocus(trigger);
        setBulkDeleting(selectedEntries);
      }}
      onDone={selection.exitSelection}
    />}
    {bulkDeleting&&<BulkDeleteFoodDialog
      open={Boolean(bulkDeleting)}
      entries={bulkDeleting}
      onClose={()=>setBulkDeleting(null)}
      onDelete={handleBulkDelete}
      restoreFocus={selectionRestoreFocus}
      energyUnit={energyUnit}
    />}
    {bulkMoving&&<MoveFoodDialog
      open={Boolean(bulkMoving)}
      onClose={()=>setBulkMoving(null)}
      entries={bulkMoving}
      groups={groups}
      currentDate={current}
      onMove={async(moving,destDate,destTime)=>{
        await move(moving,destDate,destTime);
        selection.exitSelection();
      }}
      restoreFocus={selectionRestoreFocus}
    />}
  </div>;
}

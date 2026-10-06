import {useState,useRef} from 'react';
import {CheckCheck,Copy,MoreVertical,Plus,Trash2} from 'lucide-react';
import type {NutritionStore} from '../useNutritionStore';
import type {Entry} from '../types';
import {useHistoryWindow} from '../useHistoryWindow';
import {number,today} from '../lib/format';
import {shiftDate} from '../lib/energyBalance';
import {dayStatus} from '../lib/loggingDay';
import {mealReadOnly,moveEntry,showsDeviceOnlyToday,type TimelineView} from '../lib/foodDiary';
import {useOnlineStatus} from './ui/useOnlineStatus';
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
import {FoodWeekStrip} from './FoodWeekStrip';
import {useDaySwipe} from './useDaySwipe';
import {DiaryEmptyState} from './DiaryEmptyState';
import {FoodDaySkeleton} from './ui/Skeleton';
import { showUndo } from './ui/UndoToast';
import { UNDO_WINDOW_MS } from '../lib/heldMutations';
import { CopyFoodDialog } from './CopyFoodDialog';
import { MoveFoodDialog } from './MoveFoodDialog';
import { Modal } from './ui/Modal';
import { useDismissablePopover } from './ui/useDismissablePopover';

export function FoodDiary({store,date,setDate,onLog,onEdit,onCopyDay}:{store:NutritionStore;date:string;setDate:(date:string)=>void;onLog:(time?:string)=>void;onEdit:(entry:Entry)=>void;onCopyDay:(date:string,entries:Entry[],trigger:HTMLElement)=>void}){
  const history=useHistoryWindow(store,date);
  const [error,setError]=useState('');
  const [timelineView,setTimelineView]=useState<TimelineView>('data');
  const [bulkMoving,setBulkMoving]=useState<Entry[]|null>(null);
  const [bulkCopying,setBulkCopying]=useState<Entry[]|null>(null);
  const [selectionRestoreFocus,setSelectionRestoreFocus]=useState<HTMLElement|null>(null);
  const [isMenuOpen,setIsMenuOpen]=useState(false);
  const [confirmingClearDay,setConfirmingClearDay]=useState(false);
  const menuAnchorRef=useRef<HTMLDivElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  useDismissablePopover(isMenuOpen,[menuAnchorRef,menuRef],()=>setIsMenuOpen(false));

  const selection=useFoodSelection();
  const clipboard=useFoodClipboard();
  const exitSelectionAndCopy=()=>{
    clipboard.clear();
    selection.exitSelection();
  };

  const current=today(store.state!.profile?.timeZone);
  const online=useOnlineStatus();
  const currentUncached=showsDeviceOnlyToday({isToday:date===current,hasHistory:!!history.state,loading:history.loading,online});
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
  // The day after today can be opened to plan ahead; nothing further out can.
  const latest=shiftDate(current,1);
  const changeDate=(value:string)=>{if(value>='2000-01-01'&&value<=latest){setError('');selection.exitSelection();setDate(value);}};

  // Touch swipe between days; selection mode and the move/copy dialogs keep the touch to themselves.
  const swipe=useDaySwipe({enabled:!selection.isSelecting&&clipboard.count===0&&!bulkMoving&&!bulkCopying,date,canPrevious:date>'2000-01-01',canNext:date<latest,onNavigate:delta=>changeDate(shiftDate(date,delta))});

  const move=async(moving:Entry[],destinationDate:string,time?:string|null)=>{
    await act(async()=>{
      const operations=[];
      for(const entry of moving){
        const currentEntry=entries.find(e=>e.id===entry.id)??entry;
        const targetTime=time!==undefined?time:(currentEntry.time??null);
        const operation=moveEntry(currentEntry,targetTime,destinationDate);
        if(operation)operations.push(operation);
      }
      await store.mutateMany(operations);
    },true);
  };

  const copy=async(entry:Entry,destinationDate:string,time:string|null)=>{await act(()=>store.mutate({kind:'entry',recordId:crypto.randomUUID(),expectedRevision:0,delete:false,data:{...entry,date:destinationDate,time}}),true);};
  // Deletion is immediate and undoable: the request waits out the undo window before it is sent.
  const removeEntries=async(removing:Entry[])=>{
    const ids:string[]=[];
    await act(async()=>{
      ids.push(...await store.mutateMany(removing.map(entry=>{
        const currentEntry=entries.find(e=>e.id===entry.id)??entry;
        return {kind:'entry' as const,recordId:currentEntry.id,expectedRevision:currentEntry.revision,delete:true,data:currentEntry};
      }),{holdMs:UNDO_WINDOW_MS}));
    },true);
    showUndo(removing.length===1?`Deleted ${removing[0].name}`:`Deleted ${removing.length} foods`,()=>store.undo(ids));
  };
  const remove=(entry:Entry)=>removeEntries([entry]);

  const selectedEntries=entries.filter(e=>selection.isSelected(e.id));
  const selectedCalories=selectedEntries.reduce((sum,e)=>sum+e.calories,0);

  const pasteEntriesTo=async(items:Entry[],targetDate:string,targetTime?:string|null)=>{
    if(!items.length)return;
    await act(async()=>{
      const mutations=createPasteMutations(items,targetDate,targetTime);
      await store.mutateMany(mutations);
    },true);
    exitSelectionAndCopy();
    if(targetDate!==date){
      changeDate(targetDate);
    }
  };

  const handlePasteAtTime=async(time:string)=>{
    if(!clipboard.clipboard)return;
    await pasteEntriesTo(clipboard.clipboard.entries,date,time);
  };

  return <div className="food-log-page">
    <header className="page-heading">
      <div><h1 data-page-heading tabIndex={-1}>Food Log</h1><p>Review entries by time, copy or move them, and remove mistakes.</p></div>
      <div className="page-heading-actions">
        {(selection.isSelecting||clipboard.count>0)&&(
          <Button
            variant="tertiary"
            aria-label="Done selecting"
            onClick={exitSelectionAndCopy}
          >
            <CheckCheck size={18}/>
            Done
          </Button>
        )}
        <div className="food-diary-menu-anchor" ref={menuAnchorRef}>
          <Button
            variant="secondary"
            size="icon"
            className="food-diary-menu-trigger"
            aria-label="Day options"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={()=>setIsMenuOpen(v=>!v)}
          >
            <MoreVertical size={20}/>
          </Button>
          {isMenuOpen&&<div className="food-diary-dropdown" role="menu" ref={menuRef}>
            <Button
              presentation="plain"
              className="food-diary-dropdown-item"
              role="menuitem"
              disabled={entries.length===0}
              onClick={e=>{setIsMenuOpen(false);onCopyDay(date,entries,e.currentTarget);}}
            >
              <Copy size={16} aria-hidden="true"/>
              <span>Copy day</span>
            </Button>
            <Button
              presentation="plain"
              className="food-diary-dropdown-item"
              role="menuitem"
              disabled={entries.length===0||readOnly}
              onClick={()=>{setIsMenuOpen(false);clipboard.clear();selection.enterSelection();}}
            >
              <CheckCheck size={16} aria-hidden="true"/>
              <span>Bulk select</span>
            </Button>
            <Button
              presentation="plain"
              className="food-diary-dropdown-item food-diary-dropdown-item-danger"
              role="menuitem"
              disabled={entries.length===0||readOnly}
              onClick={()=>{setIsMenuOpen(false);setConfirmingClearDay(true);}}
            >
              <Trash2 size={16} aria-hidden="true"/>
              <span>Clear day</span>
            </Button>
          </div>}
        </div>
        <Button variant="primary" disabled={readOnly} onClick={()=>onLog()}><Plus size={18}/>Log food</Button>
      </div>
    </header>
    <div className="food-day-swipe" {...swipe.bind}>
    <div className="food-diary-toolbar">
      <div className="food-date-navigation">
        <DatePicker label="Food date" value={date} min="2000-01-01" max={latest} onChange={changeDate}/>
        <Button onClick={()=>changeDate(current)} disabled={date===current}>Today</Button>
      </div>
      <FoodWeekStrip date={date} today={current} store={store} onChange={changeDate}/>
      {date<current&&<div className="food-diary-toolbar-right">
        <SelectField
          label="Logging status"
          disabled={count>0}
          value={status==='fasting'||status==='not_logged'?status:'incomplete'}
          onChange={value=>{
            if(count>0)return;
            void act(()=>store.mutate({kind:'day',recordId:day?.id??crypto.randomUUID(),expectedRevision:day?.revision??0,data:{date,status:value},delete:false}));
          }}
        >
          <option value="incomplete">{count?'Complete automatically':'No food logged'}</option>
          <option value="not_logged" disabled={count>0}>Not logging</option>
          <option value="fasting" disabled={count>0||total>0}>Fasting</option>
        </SelectField>
      </div>}
    </div>
    <div className="food-day-content" ref={swipe.contentRef}>
    {history.error&&<CardFeedback
      title={state?'Diary history needs attention':'Diary history unavailable'}
      message={`${state?'Saved history shown.':'This day is not available on this device. Connect to load its history.'} ${history.error}`}
      action={{label:'Retry history',onClick:history.retry}}
    />}
    {!state&&history.error&&<DiaryEmptyState status="unavailable" unavailable/>}
    {currentUncached&&<p className="notice" role="status">Only entries saved on this device are shown. Other entries will load when connected. You can keep logging today.</p>}
    {!state&&!history.error&&<section className="panel food-day-summary skeleton" aria-busy="true">
      <div className="section-heading"><div><h2>{date===current?'Today':date===shiftDate(current,-1)?'Yesterday':date===latest?'Tomorrow':date}</h2><p>Loading diary date…</p></div></div>
    </section>}
    {!state&&!history.error&&<FoodDaySkeleton/>}
    {error&&<CardFeedback title="Diary action failed" message={error}/>}
    {state&&<>
      <section className="panel food-day-summary">
        <div className="section-heading"><div><h2>{date===current?'Today':date===shiftDate(current,-1)?'Yesterday':date===latest?'Tomorrow':date}</h2><p>{status==='complete'?'Complete':status==='fasting'?'Fasting':status==='not_logged'?'Not logging':date===current?'Still logging':date===latest?'Planning ahead':'No food logged'}</p></div>
          <strong className="figure-inline">{count||status==='fasting'?displayEnergy(total,energyUnit):'—'} <span className="unit">{energyLabel(energyUnit)}</span></strong>
        </div>
        <dl className="food-day-nutrients">{(['protein','carbs','fat'] as const).map(key=>{
          const known=entries.filter(e=>e[key]!=null);
          const value=archived?day?.[key]:known.length?known.reduce((sum,e)=>sum+e[key]!,0):null;
          const partial=!archived&&known.length>0&&known.length<entries.length;
          return <div key={key}><dt>{key[0].toUpperCase()+key.slice(1)}</dt><dd>{number(value)} g{partial?' · partial':''}</dd></div>;
        })}</dl>
      </section>
      {readOnly?<DiaryEmptyState status={status} archived detailDays={state.detailDays} summary={`${count} food ${count===1?'entry':'entries'}${count?` · ${displayEnergy(total,energyUnit)} ${energyLabel(energyUnit)}`:''}`}/>:<>
        <div className="food-timeline-toolbar">
          <div><h2>Food timeline</h2><p>Show only logged times or every hour from 12 AM through 11 PM.</p></div>
          <SegmentedControl<TimelineView> id="food-timeline-view" label="Food timeline hours" value={timelineView} onChange={setTimelineView} options={[{value:'data',label:'Hours with data'},{value:'full',label:'Full day'}]}/>
        </div>
        {!entries.length&&timelineView==='data'&&<DiaryEmptyState status={status} offline={currentUncached} onLog={()=>onLog()}/>}
        {(selection.isSelecting||clipboard.count>0)&&<FoodSelectionBar
          selectedCount={selectedEntries.length}
          totalCount={entries.length}
          totalCalories={selectedCalories}
          copiedCount={clipboard.count}
          copiedCalories={clipboard.totalCalories}
          energyUnit={energyUnit}
          onSelectAll={()=>selection.selectAll(entries.map(e=>e.id))}
          onDeselectAll={selection.deselectAll}
          onEdit={()=>{
            if(selectedEntries.length===1){
              const target=selectedEntries[0];
              exitSelectionAndCopy();
              onEdit(target);
            }
          }}
          onCopy={()=>{
            clipboard.copy(selectedEntries,date);
          }}
          onMove={trigger=>{
            setSelectionRestoreFocus(trigger);
            setBulkMoving(selectedEntries);
          }}
          onDelete={()=>{
            const deleting=selectedEntries;
            exitSelectionAndCopy();
            void removeEntries(deleting).catch(()=>{});
          }}
          onPaste={()=>{
            if(clipboard.clipboard){
              void pasteEntriesTo(clipboard.clipboard.entries,date).catch(()=>{});
            }
          }}
          onPasteToToday={()=>{
            if(clipboard.clipboard){
              void pasteEntriesTo(clipboard.clipboard.entries,current).catch(()=>{});
            }
          }}
          onPasteToTomorrow={()=>{
            if(clipboard.clipboard){
              void pasteEntriesTo(clipboard.clipboard.entries,shiftDate(current,1)).catch(()=>{});
            }
          }}
          onPasteDateAndTime={trigger=>{
            if(clipboard.clipboard){
              setSelectionRestoreFocus(trigger);
              setBulkCopying(clipboard.clipboard.entries);
            }
          }}
          onBackFromCopy={()=>{
            clipboard.clear();
            if(selectedEntries.length===0){
              selection.exitSelection();
            }else if(!selection.isSelecting){
              selection.enterSelection();
            }
          }}
          onDone={exitSelectionAndCopy}
        />}
        <FoodTimeline
          store={store}
          date={date}
          currentDate={current}
          entries={entries}
          readOnly={readOnly}
          onEdit={onEdit}
          onMove={async(moving,destDate,destTime)=>{
            await move(moving,destDate,destTime);
            if(destDate!==date){
              changeDate(destDate);
            }
          }}
          onCopy={copy}
          onDelete={remove}
          showEmptySlots
          timelineView={timelineView}
          onAddAtTime={readOnly?undefined:onLog}
          isSelecting={selection.isSelecting&&clipboard.count===0}
          selectedIds={selection.selectedIds}
          onToggleSelect={selection.toggle}
          onLongPressSelect={id=>{clipboard.clear();selection.enterSelection(id);}}
          clipboardCount={clipboard.count}
          onPasteAtTime={readOnly?undefined:handlePasteAtTime}
        />
      </>}
    </>}
    </div>
    </div>
    {bulkCopying&&bulkCopying[0]&&<CopyFoodDialog
      open
      onClose={()=>setBulkCopying(null)}
      entry={bulkCopying[0]}
      currentDate={current}
      onCopy={async(_,destDate,destTime)=>{
        await pasteEntriesTo(bulkCopying,destDate,destTime);
      }}
      restoreFocus={selectionRestoreFocus}
    />}
    {bulkMoving&&<MoveFoodDialog
      open={Boolean(bulkMoving)}
      onClose={()=>setBulkMoving(null)}
      entries={bulkMoving}
      currentDate={current}
      onMove={async(moving,destDate,destTime)=>{
        await move(moving,destDate,destTime);
        exitSelectionAndCopy();
        if(destDate!==date){
          changeDate(destDate);
        }
      }}
      restoreFocus={selectionRestoreFocus}
    />}
    {confirmingClearDay&&<Modal
      open={confirmingClearDay}
      onClose={()=>setConfirmingClearDay(false)}
      title="Clear day?"
      description={`Remove all ${entries.length} food ${entries.length===1?'entry':'entries'} logged for ${date}?`}
      width="sm"
    >
      <div className="modal-actions">
        <Button variant="secondary" onClick={()=>setConfirmingClearDay(false)}>Cancel</Button>
        <Button variant="destructive" onClick={async()=>{
          setConfirmingClearDay(false);
          exitSelectionAndCopy();
          await removeEntries(entries);
        }}>Clear day</Button>
      </div>
    </Modal>}
  </div>;
}

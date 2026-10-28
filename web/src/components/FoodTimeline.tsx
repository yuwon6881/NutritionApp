import {useCallback,useState,useRef,useEffect} from 'react';
import {readableDate} from '../lib/format';
import {Plus} from 'lucide-react';
import type {NutritionStore} from '../useNutritionStore';
import type {Entry} from '../types';
import {timelineGroups,timelineSlots,moveAnnouncement,type TimelineView} from '../lib/foodDiary';
import {Button} from './ui/Button';
import {CopyFoodDialog,MoveFoodDialog} from './LazyFoodDialogs';
import {unitsFor} from '../lib/units';
import {FoodTimeCard} from './FoodTimeCard';
import {useTimelineDrag} from './useTimelineDrag';
import {useLingering} from './ui/useLingering';

export interface FoodTimelineProps {
  store:NutritionStore;
  date:string;
  currentDate:string;
  entries:Entry[];
  readOnly:boolean;
  onEdit:(entry:Entry)=>void;
  onMove:(moving:Entry[],date:string,time:string|null|undefined)=>Promise<void>|void;
  onCopy:(entry:Entry,date:string,time:string|null)=>Promise<void>|void;
  onDelete:(entry:Entry)=>Promise<void>|void;
  showEmptySlots?:boolean;
  timelineView?:TimelineView;
  onAddAtTime?:(time:string)=>void;
  isSelecting?:boolean;
  selectedIds?:Set<string>;
  onToggleSelect?:(id:string)=>void;
  onLongPressSelect?:(id:string)=>void;
  clipboardCount?:number;
  onPasteAtTime?:(time:string)=>void;
}

export function FoodTimeline({
  store,
  date,
  currentDate,
  entries,
  readOnly,
  onEdit,
  onMove,
  onCopy,
  onDelete,
  showEmptySlots=false,
  timelineView='full',
  onAddAtTime,
  isSelecting=false,
  selectedIds,
  onToggleSelect,
  onLongPressSelect,
  clipboardCount=0,
  onPasteAtTime,
}:FoodTimelineProps){
  const [movingEntries,setMovingEntries]=useState<Entry[]|null>(null);
  const [copyingEntry,setCopyingEntry]=useState<Entry|null>(null);
  const [restoreFocus,setRestoreFocus]=useState<HTMLElement|null>(null);
  const [announcement,setAnnouncement]=useState('');
  const energyUnit=unitsFor(store.state?.settings).energy;
  // Checkboxes stay for their exit animation after selection ends, so the cards slide back.
  const checkboxesLeaving=useLingering(isSelecting);

  const groups=showEmptySlots?timelineSlots(entries,0,23,timelineView):timelineGroups(entries);
  const previousTimes=useRef(new Map<string,string|null>());
  const [movedIds,setMovedIds]=useState<Set<string>>(()=>new Set());
  const previousIds=useRef<Set<string>|null>(null);
  const [addedIds,setAddedIds]=useState<Set<string>>(()=>new Set());

  useEffect(()=>{
    const changed=entries.filter(entry=>{
      const previous=previousTimes.current.get(entry.id);
      previousTimes.current.set(entry.id,entry.time??null);
      return previous!==undefined&&previous!==(entry.time??null);
    }).map(entry=>entry.id);
    if(changed.length&&changed.length<=8){
      setMovedIds(new Set(changed));
      const timer=window.setTimeout(()=>setMovedIds(new Set()),260);
      return()=>window.clearTimeout(timer);
    }
  },[entries]);

  useEffect(()=>{
    if(!previousIds.current){
      previousIds.current=new Set(entries.map(e=>e.id));
      return;
    }
    const newlyAdded=entries.filter(entry=>!previousIds.current!.has(entry.id)).map(e=>e.id);
    previousIds.current=new Set(entries.map(e=>e.id));
    if(!newlyAdded.length||newlyAdded.length>8)return;
    setAddedIds(new Set(newlyAdded));
    const timer=window.setTimeout(()=>setAddedIds(new Set()),350);
    return()=>window.clearTimeout(timer);
  },[entries]);

  const handleMove=async(moving:Entry[],destinationDate:string,time:string|null|undefined)=>{
    await onMove(moving,destinationDate,time);
    setAnnouncement(moveAnnouncement(moving.length,time??null));
  };

  const {draggingEntry,dropOverTime,bindDrag,swipeFor,closeReveal}=useTimelineDrag({
    enabled:!readOnly&&!isSelecting,
    onDrop:(entry,targetTime)=>void handleMove([entry],date,targetTime),
    onHoldSelect:entry=>onLongPressSelect?.(entry.id),
  });

  // Stable card-level callbacks: the identity stays the same across renders so that
  // React.memo on FoodTimeCard can skip re-rendering cards whose own data hasn't changed.
  const onToggleSelectRef=useRef(onToggleSelect);
  onToggleSelectRef.current=onToggleSelect;
  const stableToggleSelect=useCallback((id:string)=>onToggleSelectRef.current?.(id),[]);
  const onDeleteRef=useRef(onDelete);
  onDeleteRef.current=onDelete;
  const onEditRef=useRef(onEdit);
  onEditRef.current=onEdit;
  const stableCardEdit=useCallback((item:Entry)=>{closeReveal();onEditRef.current(item);},[closeReveal]);
  const stableCardCopy=useCallback((item:Entry,trigger:HTMLElement)=>{closeReveal();setRestoreFocus(trigger);setCopyingEntry(item);},[closeReveal]);
  const stableCardMove=useCallback((item:Entry,trigger:HTMLElement)=>{closeReveal();setRestoreFocus(trigger);setMovingEntries([item]);},[closeReveal]);
  const stableCardDelete=useCallback((item:Entry)=>{closeReveal();void Promise.resolve(onDeleteRef.current(item)).catch(()=>{});},[closeReveal]);

  return <>
    {announcement&&<p role="status" className="sr-only">{announcement}</p>}
    <ol className="food-timeline" aria-label={`Food timeline for ${readableDate(date)}`}>
      {groups.map(group=><li
        className="food-time-row"
        key={group.time}
        data-time-row={group.time}
        data-drop-over={dropOverTime===group.time?true:undefined}
        data-empty={group.entries.length===0?true:undefined}
      >
        <div className="food-time-label">
          <span className="food-time-label-main">{group.time?<time dateTime={`${date}T${group.time}`}>{group.label}</time>:group.label}</span>
          <div className="food-slot-actions">
            {group.entries.length>0&&group.time&&onAddAtTime&&<Button
              variant="tertiary"
              size="icon"
              className="food-slot-add"
              aria-label={`Add food at ${group.label}`}
              onClick={()=>onAddAtTime(group.time)}
            ><Plus size={16} strokeWidth={2.4} aria-hidden="true"/></Button>}
          </div>
        </div>
        <div className={`food-time-cards ${group.entries.length===0?'food-time-cards-empty':''}`}>
          {group.entries.length===0&&(
            <div className="food-empty-slot-actions">
              {onAddAtTime&&<Button variant="tertiary" className="food-empty-slot-action" onClick={()=>onAddAtTime(group.time)}>
                Add food at {group.label}
              </Button>}
              {clipboardCount>0&&onPasteAtTime&&<Button variant="tertiary" className="food-empty-slot-paste" onClick={()=>onPasteAtTime(group.time)}>
                Paste {clipboardCount} {clipboardCount===1?'food':'foods'} at {group.label}
              </Button>}
            </div>
          )}
          {group.entries.map(entry=>{
            const pending=store.local?.queue.filter(op=>op.kind==='entry'&&op.recordId===entry.id)??[];
            const dragProps=bindDrag(entry);
            return <FoodTimeCard
              key={entry.id}
              entry={entry}
              energyUnit={energyUnit}
              readOnly={readOnly}
              isSelecting={isSelecting}
              checkboxLeaving={checkboxesLeaving}
              isSelected={Boolean(selectedIds?.has(entry.id))}
              isMoved={movedIds.has(entry.id)}
              isAdded={addedIds.has(entry.id)}
              isPendingSync={pending.length>0}
              onEdit={stableCardEdit}
              onToggleSelect={stableToggleSelect}
              dragProps={dragProps}
              swipe={swipeFor(entry)}
              onCopy={stableCardCopy}
              onMove={stableCardMove}
              onDelete={stableCardDelete}
            />;
          })}
        </div>
      </li>)}
    </ol>
    {copyingEntry&&<CopyFoodDialog
      open={Boolean(copyingEntry)}
      entry={copyingEntry}
      currentDate={currentDate}
      onClose={()=>setCopyingEntry(null)}
      onCopy={onCopy}
      restoreFocus={restoreFocus}
    />}
    {movingEntries&&<MoveFoodDialog
      open={Boolean(movingEntries)}
      onClose={()=>setMovingEntries(null)}
      entries={movingEntries}
      groups={groups}
      currentDate={currentDate}
      onMove={handleMove}
      restoreFocus={restoreFocus}
    />}
  </>;
}

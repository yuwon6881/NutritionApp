import {useCallback,useState,useRef,useEffect} from 'react';
import {ClipboardPaste,Copy,MoveRight,Pencil,Trash2} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Entry} from '../types';
import {timelineGroups,timelineSlots,moveAnnouncement,type TimelineView} from '../lib/foodDiary';
import {Button} from './ui/Button';
import {ActionSheet,type ActionSheetOption} from './ui/ActionSheet';
import {CopyFoodDialog} from './CopyFoodDialog';
import {MoveFoodDialog} from './MoveFoodDialog';
import {unitsFor} from '../lib/units';
import {FoodTimeCard} from './FoodTimeCard';
import {useTimelineDrag} from './useTimelineDrag';

export interface FoodTimelineProps {
  store:Nourish;
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
  const [actionEntry,setActionEntry]=useState<Entry|null>(null);
  const [restoreFocus,setRestoreFocus]=useState<HTMLElement|null>(null);
  const [announcement,setAnnouncement]=useState('');
  const energyUnit=unitsFor(store.state?.settings).energy;

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

  const openActions=useCallback((entry:Entry,trigger:HTMLElement)=>{
    setRestoreFocus(trigger);
    setActionEntry(entry);
  },[]);

  const actionOptions:ActionSheetOption[]=actionEntry?[{
    id:'edit',label:'Edit',description:'Change the logged food or portion.',icon:<Pencil size={20}/>,onClick:()=>onEdit(actionEntry)
  },{
    id:'copy',label:'Copy',description:'Add this food to another date or time.',icon:<Copy size={20}/>,onClick:()=>setCopyingEntry(actionEntry)
  },{
    id:'move',label:'Move to',description:'Change the date or time without duplicating it.',icon:<MoveRight size={20}/>,onClick:()=>setMovingEntries([actionEntry])
  },{
    id:'delete',label:'Delete',description:'Remove this logged entry.',icon:<Trash2 size={20}/>,variant:'destructive',onClick:()=>void Promise.resolve(onDelete(actionEntry)).catch(()=>{})
  }]:[];

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
  const stableCardCopy=useCallback((item:Entry,trigger:HTMLElement)=>{closeReveal();setRestoreFocus(trigger);setCopyingEntry(item);},[closeReveal]);
  const stableCardMove=useCallback((item:Entry,trigger:HTMLElement)=>{closeReveal();setRestoreFocus(trigger);setMovingEntries([item]);},[closeReveal]);
  const stableCardDelete=useCallback((item:Entry)=>{closeReveal();void Promise.resolve(onDeleteRef.current(item)).catch(()=>{});},[closeReveal]);

  return <>
    {announcement&&<p role="status" className="sr-only">{announcement}</p>}
    <ol className="food-timeline" aria-label={`Food timeline for ${date}`}>
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
            >+</Button>}
            {group.time&&clipboardCount>0&&onPasteAtTime&&<Button
              variant="tertiary"
              size="icon"
              className="food-slot-paste"
              aria-label={`Paste ${clipboardCount} foods at ${group.label}`}
              title={`Paste ${clipboardCount} foods at ${group.label}`}
              onClick={()=>onPasteAtTime(group.time)}
            ><ClipboardPaste size={16}/></Button>}
          </div>
          {group.entries.length>1&&!readOnly&&!isSelecting&&<div className="food-slot-move-all">
            <Button
              variant="tertiary"
              size="sm"
              aria-label={`Move all ${group.entries.length} entries from ${group.label}`}
              onClick={e=>{
                setRestoreFocus(e.currentTarget);
                setMovingEntries(group.entries);
              }}
            >
              Move all
            </Button>
          </div>}
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
              isSelected={Boolean(selectedIds?.has(entry.id))}
              isMoved={movedIds.has(entry.id)}
              isAdded={addedIds.has(entry.id)}
              pendingError={pending.find(op=>op.error)?.error}
              isPendingSync={pending.length>0}
              onEdit={onEdit}
              onOpenActions={openActions}
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
    <ActionSheet
      isOpen={Boolean(actionEntry)}
      onClose={()=>setActionEntry(null)}
      restoreFocus={restoreFocus}
      title="Food actions"
      subtitle={actionEntry?.name??'Choose an action'}
      options={actionOptions}
    />
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

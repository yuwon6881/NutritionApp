import {useState,useRef,useEffect,useCallback} from 'react';
import {ClipboardPaste,Copy,MoveRight,Pencil,Trash2} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Entry} from '../types';
import {timelineGroups,timelineSlots,dropTarget,moveAnnouncement,type DropRow,type TimelineView} from '../lib/foodDiary';
import {Button} from './ui/Button';
import {ActionSheet,type ActionSheetOption} from './ui/ActionSheet';
import {CopyFoodDialog} from './CopyFoodDialog';
import {DeleteFoodDialog} from './DeleteFoodDialog';
import {MoveFoodDialog} from './MoveFoodDialog';
import {unitsFor} from '../lib/units';
import {FoodTimeCard} from './FoodTimeCard';

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
  const [deletingEntry,setDeletingEntry]=useState<Entry|null>(null);
  const [actionEntry,setActionEntry]=useState<Entry|null>(null);
  const [restoreFocus,setRestoreFocus]=useState<HTMLElement|null>(null);
  const [announcement,setAnnouncement]=useState('');
  const energyUnit=unitsFor(store.state?.settings).energy;

  const groups=showEmptySlots?timelineSlots(entries,0,23,timelineView):timelineGroups(entries);
  const previousTimes=useRef(new Map<string,string|null>());
  const [movedIds,setMovedIds]=useState<Set<string>>(()=>new Set());

  useEffect(()=>{
    const changed=entries.filter(entry=>{
      const previous=previousTimes.current.get(entry.id);
      previousTimes.current.set(entry.id,entry.time??null);
      return previous!==undefined&&previous!==(entry.time??null);
    }).map(entry=>entry.id);
    if(!changed.length||changed.length>8)return;
    setMovedIds(new Set(changed));
    const timer=window.setTimeout(()=>setMovedIds(new Set()),260);
    return()=>window.clearTimeout(timer);
  },[entries]);

  const handleMove=async(moving:Entry[],destinationDate:string,time:string|null|undefined)=>{
    await onMove(moving,destinationDate,time);
    setAnnouncement(moveAnnouncement(moving.length,time??null));
  };

  const openActions=(entry:Entry,trigger:HTMLElement)=>{
    setRestoreFocus(trigger);
    setActionEntry(entry);
  };

  const actionOptions:ActionSheetOption[]=actionEntry?[{
    id:'edit',label:'Edit',description:'Change the logged food or portion.',icon:<Pencil size={20}/>,onClick:()=>onEdit(actionEntry)
  },{
    id:'copy',label:'Copy',description:'Add this food to another date or time.',icon:<Copy size={20}/>,onClick:()=>setCopyingEntry(actionEntry)
  },{
    id:'move',label:'Move to',description:'Change the date or time without duplicating it.',icon:<MoveRight size={20}/>,onClick:()=>setMovingEntries([actionEntry])
  },{
    id:'delete',label:'Delete',description:'Remove this logged entry.',icon:<Trash2 size={20}/>,variant:'destructive',onClick:()=>setDeletingEntry(actionEntry)
  }]:[];

  const {draggingEntry,dropOverTime,bindDrag}=useTimelineDrag({
    enabled:!readOnly&&!isSelecting,
    onDrop:(entry,targetTime)=>void handleMove([entry],date,targetTime),
  });

  return <>
    {announcement&&<p role="status" style={{position:'absolute',width:1,height:1,padding:0,margin:-1,overflow:'hidden',clip:'rect(0,0,0,0)',whiteSpace:'nowrap',border:0}}>{announcement}</p>}
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
          {group.entries.length>1&&!readOnly&&!isSelecting&&<div style={{marginTop:4}}>
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
              pendingError={pending.find(op=>op.error)?.error}
              isPendingSync={pending.length>0}
              onEdit={onEdit}
              onOpenActions={openActions}
              onToggleSelect={id=>onToggleSelect?.(id)}
              onLongPressSelect={id=>onLongPressSelect?.(id)}
              dragProps={dragProps}
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
    {deletingEntry&&<DeleteFoodDialog
      open={Boolean(deletingEntry)}
      entry={deletingEntry}
      onClose={()=>setDeletingEntry(null)}
      onDelete={onDelete}
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

function useTimelineDrag({
  enabled,
  onDrop,
}:{
  enabled:boolean;
  onDrop:(entry:Entry,targetTime:string)=>void;
}){
  const [draggingEntry,setDraggingEntry]=useState<Entry|null>(null);
  const [dropOverTime,setDropOverTime]=useState<string|null>(null);
  const isEnabled=enabled;

  const activeRef=useRef<{
    entry:Entry;
    targetEl:HTMLElement;
    pointerId:number;
    pointerType:string;
    startX:number;
    startY:number;
    lifted:boolean;
    touchTimer?:ReturnType<typeof setTimeout>;
    rowRects:DropRow[];
    currentTargetTime?:string;
  }|null>(null);

  const cancelDrag=useCallback(()=>{
    if(activeRef.current?.touchTimer){
      clearTimeout(activeRef.current.touchTimer);
    }
    if(activeRef.current){
      try{
        activeRef.current.targetEl.releasePointerCapture(activeRef.current.pointerId);
      }catch{}
    }
    activeRef.current=null;
    setDraggingEntry(null);
    setDropOverTime(null);
  },[]);

  useEffect(()=>{
    if(!draggingEntry)return;
    const blockTouch=(e:TouchEvent)=>{
      if(e.cancelable)e.preventDefault();
    };
    window.addEventListener('touchmove',blockTouch,{passive:false});
    return()=>window.removeEventListener('touchmove',blockTouch);
  },[draggingEntry]);

  useEffect(()=>{
    if(!draggingEntry)return;
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape')cancelDrag();
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[draggingEntry,cancelDrag]);

  const snapshotRows=():DropRow[]=>{
    const elements=Array.from(document.querySelectorAll<HTMLElement>('.food-time-row[data-time-row]'));
    return elements
      .filter(el=>el.dataset.timeRow!==undefined&&el.dataset.timeRow!=='')
      .map(el=>{
        const rect=el.getBoundingClientRect();
        return {
          time:el.dataset.timeRow!,
          top:rect.top,
          bottom:rect.bottom,
        };
      });
  };

  const lift=(entry:Entry,rowRects:DropRow[],clientY:number)=>{
    if(!activeRef.current)return;
    activeRef.current.lifted=true;
    activeRef.current.rowRects=rowRects;
    const target=dropTarget(rowRects,clientY);
    activeRef.current.currentTargetTime=target;
    setDraggingEntry(entry);
    setDropOverTime(target??null);
  };

  const onPointerDown=(entry:Entry,event:React.PointerEvent<HTMLElement>)=>{
    if(!isEnabled)return;
    const target=event.target as HTMLElement;
    if(target.closest('button,a,input,select,textarea,summary,.food-card-select-checkbox'))return;

    const el=event.currentTarget;
    const pointerId=event.pointerId;
    const pointerType=event.pointerType;
    const startX=event.clientX;
    const startY=event.clientY;

    const current:NonNullable<typeof activeRef.current>={
      entry,
      targetEl:el,
      pointerId,
      pointerType,
      startX,
      startY,
      lifted:false,
      rowRects:[],
    };
    activeRef.current=current;

    try{
      el.setPointerCapture(pointerId);
    }catch{}

    if(pointerType==='touch'){
      current.touchTimer=setTimeout(()=>{
        if(activeRef.current===current&&!current.lifted){
          const rows=snapshotRows();
          lift(entry,rows,startY);
        }
      },350);
    }
  };

  const onPointerMove=(event:React.PointerEvent<HTMLElement>)=>{
    const current=activeRef.current;
    if(!current)return;

    const dx=event.clientX-current.startX;
    const dy=event.clientY-current.startY;
    const dist=Math.hypot(dx,dy);

    if(!current.lifted){
      if(current.pointerType==='mouse'){
        if(dist>=8){
          const rows=snapshotRows();
          lift(current.entry,rows,event.clientY);
        }
      }else{
        if(dist>6&&current.touchTimer){
          clearTimeout(current.touchTimer);
          cancelDrag();
        }
      }
      return;
    }

    const target=dropTarget(current.rowRects,event.clientY);
    current.currentTargetTime=target;
    setDropOverTime(target??null);
  };

  const onPointerUp=()=>{
    const current=activeRef.current;
    if(!current)return;

    if(current.touchTimer)clearTimeout(current.touchTimer);

    if(current.lifted&&current.currentTargetTime){
      const entry=current.entry;
      const targetTime=current.currentTargetTime;
      if(targetTime!==(entry.time??null)){
        onDrop(entry,targetTime);
      }
    }

    cancelDrag();
  };

  return {
    isEnabled,
    draggingEntry,
    dropOverTime,
    bindDrag:(entry:Entry)=>({
      onPointerDown:(e:React.PointerEvent<HTMLElement>)=>onPointerDown(entry,e),
      onPointerMove,
      onPointerUp,
      onPointerCancel:cancelDrag,
      'data-draggable':isEnabled?true:undefined,
      'data-dragging':draggingEntry?.id===entry.id?true:undefined,
    }),
  };
}

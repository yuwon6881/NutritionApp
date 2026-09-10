import {useState,useRef,useEffect,useCallback} from 'react';
import {Copy,Trash2} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Entry} from '../types';
import {number} from '../lib/format';
import {timelineGroups,timelineSlots,dropTarget,moveAnnouncement,type DropRow,type TimelineView} from '../lib/foodDiary';
import {Button} from './ui/Button';
import {MoveFoodDialog} from './MoveFoodDialog';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {displayPortion} from '../lib/portions';

export interface FoodTimelineProps {
  store:Nourish;
  date:string;
  entries:Entry[];
  readOnly:boolean;
  onEdit:(entry:Entry)=>void;
  onMove:(moving:Entry[],time:string)=>Promise<void>|void;
  showEmptySlots?:boolean;
  timelineView?:TimelineView;
  onAddAtTime?:(time:string)=>void;
}

export function FoodTimeline({
  store,
  date,
  entries,
  readOnly,
  onEdit,
  onMove,
  showEmptySlots=false,
  timelineView='full',
  onAddAtTime,
}:FoodTimelineProps){
  const [movingEntries,setMovingEntries]=useState<Entry[]|null>(null);
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

  const handleMove=async(moving:Entry[],time:string)=>{
    await onMove(moving,time);
    setAnnouncement(moveAnnouncement(moving.length,time));
  };

  const {draggingEntry,dropOverTime,bindDrag}=useTimelineDrag({
    enabled:!readOnly,
    onDrop:(entry,targetTime)=>void handleMove([entry],targetTime),
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
          {group.time&&onAddAtTime&&<Button
            variant="tertiary"
            size="icon"
            className="food-slot-add"
            aria-label={`Add food at ${group.label}`}
            onClick={()=>onAddAtTime(group.time)}
          >+</Button>}
          {group.entries.length>1&&!readOnly&&<div style={{marginTop:4}}>
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
          {group.entries.length===0&&onAddAtTime&&<Button variant="tertiary" className="food-empty-slot-action" onClick={()=>onAddAtTime(group.time)}>
            Add food at {group.label}
          </Button>}
          {group.entries.map(entry=>{
            const pending=store.local?.queue.filter(op=>op.kind==='entry'&&op.recordId===entry.id)??[];
            const dragProps=bindDrag(entry);
            return <article
              className={`panel food-time-card ${movedIds.has(entry.id)?'food-time-card-moved':''}`.trim()}
              key={entry.id}
              {...dragProps}
            >
              <div className="section-heading">
                <h3>
                  <Button variant="tertiary" disabled={readOnly} onClick={()=>onEdit(entry)}>{entry.name}</Button>
                </h3>
                <strong>{displayEnergy(entry.calories,energyUnit)} <small>{energyLabel(energyUnit)}</small></strong>
              </div>
              <p>{entry.meal} · {displayPortion(entry)}</p>
              <dl className="food-card-nutrients">
                {(['protein','carbs','fat','fiber'] as const).filter(key=>entry[key]!=null).map(key=><div key={key}>
                  <dt>{key[0].toUpperCase()+key.slice(1)}</dt>
                  <dd>{number(entry[key])} g</dd>
                </div>)}
              </dl>
              <div className="food-card-footer">
                <small className="source">{entry.source}</small>
                <div className="actions" style={{display:'inline-flex',gap:6}}>
                  <Button
                    variant="tertiary"
                    size="sm"
                    disabled={readOnly}
                    aria-label={`Move ${entry.name}`}
                    onClick={e=>{
                      setRestoreFocus(e.currentTarget);
                      setMovingEntries([entry]);
                    }}
                  >
                    Move
                  </Button>
                  <Button
                    variant="tertiary"
                    size="sm"
                    aria-label={`Copy ${entry.name}`}
                    onClick={()=>void store.mutate({kind:'entry',recordId:crypto.randomUUID(),expectedRevision:0,data:{...entry,date},delete:false})}
                  >
                    <Copy size={16}/>
                  </Button>
                  <Button
                    variant="tertiary"
                    size="sm"
                    disabled={readOnly}
                    aria-label={`Delete ${entry.name}`}
                    onClick={()=>void store.mutate({kind:'entry',recordId:entry.id,expectedRevision:entry.revision,data:entry,delete:true})}
                  >
                    <Trash2 size={16}/>
                  </Button>
                </div>
              </div>
              {pending.length>0&&<small className="sync-label" role="status">{pending.find(op=>op.error)?.error??'Pending sync'}</small>}
            </article>;
          })}
        </div>
      </li>)}
    </ol>
    {movingEntries&&<MoveFoodDialog
      open={Boolean(movingEntries)}
      onClose={()=>setMovingEntries(null)}
      entries={movingEntries}
      groups={groups}
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
  // Reduced motion settles visual feedback; it must not remove the drag
  // affordance or the keyboard-friendly Move action.
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
    if(target.closest('button,a,input,select,textarea,summary'))return;

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

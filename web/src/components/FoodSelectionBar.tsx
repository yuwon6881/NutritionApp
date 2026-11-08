import {useRef} from 'react';
import {ArrowLeft,Calendar,CalendarPlus,CheckCheck,ClipboardPaste,Clock,Copy,MoveRight,Pencil,Trash2,X} from 'lucide-react';
import {Button} from './ui/Button';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';

export interface FoodSelectionBarProps {
  selectedCount:number;
  totalCount:number;
  totalCalories:number;
  copiedCount?:number;
  copiedCalories?:number;
  energyUnit?:EnergyUnit;
  leaving?:boolean;
  onSelectAll:()=>void;
  onDeselectAll:()=>void;
  onEdit?:()=>void;
  onCopy:()=>void;
  onMove:(trigger:HTMLElement)=>void;
  onDelete:(trigger:HTMLElement)=>void;
  onPaste?:()=>void;
  onPasteToToday?:()=>void;
  onPasteToTomorrow?:()=>void;
  onPasteDateAndTime?:(trigger:HTMLElement)=>void;
  onBackFromCopy?:()=>void;
  onDone:()=>void;
}

export function FoodSelectionBar({
  selectedCount,totalCount,totalCalories,copiedCount=0,copiedCalories=0,energyUnit='kcal',
  leaving=false,
  onSelectAll,onDeselectAll,onEdit,onCopy,onMove,onDelete,
  onPaste,onPasteToToday,onPasteToTomorrow,onPasteDateAndTime,onBackFromCopy,onDone,
}:FoodSelectionBarProps){
  const prevSelectedCount=useRef(selectedCount);
  if(selectedCount>0){
    prevSelectedCount.current=selectedCount;
  }
  const effectiveSelectedCount=leaving&&selectedCount===0?prevSelectedCount.current:selectedCount;

  const prevCalories=useRef(totalCalories);
  if(totalCalories>0){
    prevCalories.current=totalCalories;
  }
  const effectiveCalories=leaving&&totalCalories===0?prevCalories.current:totalCalories;

  const copyMode=copiedCount>0;
  const allSelected=effectiveSelectedCount>0&&effectiveSelectedCount===totalCount;
  const count=copyMode?copiedCount:effectiveSelectedCount;
  const calories=copyMode?copiedCalories:effectiveCalories;

  return (
    <aside className={`food-selection-bar${copyMode?' food-selection-bar-copy':''}${leaving?' food-selection-bar-leaving':''}`} aria-label="Bulk selection actions" role="toolbar" aria-hidden={leaving?true:undefined}>
      <div className="food-selection-bar-info">
        <strong className="food-selection-count">{copyMode?`${copiedCount} ${copiedCount===1?'food':'foods'} copied`:`${effectiveSelectedCount} selected`}</strong>
        {count>0&&<span className="food-selection-calories">{displayEnergy(calories,energyUnit)} {energyLabel(energyUnit)}</span>}
      </div>
      <div className="food-selection-bar-tools">
        {copyMode?(
          onBackFromCopy&&<Button variant="tertiary" size="sm" onClick={onBackFromCopy} aria-label="Back to selection actions" tabIndex={leaving?-1:undefined}>
            <ArrowLeft size={16} aria-hidden="true"/><span>Back</span>
          </Button>
        ):(
          <Button variant="tertiary" size="sm" onClick={allSelected?onDeselectAll:onSelectAll} aria-label={allSelected?'Deselect all foods':'Select all foods'} tabIndex={leaving?-1:undefined}>
            <CheckCheck size={16} aria-hidden="true"/><span>{allSelected?'Deselect all':'Select all'}</span>
          </Button>
        )}
        <Button variant="tertiary" size="icon" onClick={onDone} aria-label="Exit selection mode" title="Done" tabIndex={leaving?-1:undefined}>
          <X size={18} aria-hidden="true"/>
        </Button>
      </div>
      <div className="food-selection-bar-actions">
        {copyMode?<>
          <Button variant="primary" size="sm" onClick={onPaste} aria-label={copiedCount===1?'Paste copied food':`Paste ${copiedCount} copied foods`} tabIndex={leaving?-1:undefined}>
            <ClipboardPaste size={18} aria-hidden="true"/><span>Paste</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onPasteToToday} aria-label="Paste to today" tabIndex={leaving?-1:undefined}>
            <Calendar size={18} aria-hidden="true"/><span className="tab-label-full">Paste to today</span><span className="tab-label-short">To today</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onPasteToTomorrow} aria-label="Paste to tomorrow" tabIndex={leaving?-1:undefined}>
            <CalendarPlus size={18} aria-hidden="true"/><span className="tab-label-full">Paste to tomorrow</span><span className="tab-label-short">Tomorrow</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={e=>onPasteDateAndTime?.(e.currentTarget)} aria-label="Paste to date and time" tabIndex={leaving?-1:undefined}>
            <Clock size={18} aria-hidden="true"/><span>Date & time</span>
          </Button>
        </>:<>
          {effectiveSelectedCount===1&&onEdit&&<Button variant="secondary" size="sm" onClick={onEdit} aria-label="Edit selected food" tabIndex={leaving?-1:undefined}>
            <Pencil size={18} aria-hidden="true"/><span>Edit</span>
          </Button>}
          <Button variant="secondary" size="sm" disabled={effectiveSelectedCount===0} onClick={onCopy} aria-label={effectiveSelectedCount===1?'Copy selected food to clipboard':`Copy ${effectiveSelectedCount} selected foods to clipboard`} tabIndex={leaving?-1:undefined}>
            <Copy size={18} aria-hidden="true"/><span>Copy</span>
          </Button>
          <Button variant="secondary" size="sm" disabled={effectiveSelectedCount===0} onClick={e=>onMove(e.currentTarget)} aria-label={effectiveSelectedCount===1?'Move selected food':`Move ${effectiveSelectedCount} selected foods`} tabIndex={leaving?-1:undefined}>
            <MoveRight size={18} aria-hidden="true"/><span>Move</span>
          </Button>
          <Button variant="destructive" size="sm" disabled={effectiveSelectedCount===0} onClick={e=>onDelete(e.currentTarget)} aria-label={effectiveSelectedCount===1?'Delete selected food':`Delete ${effectiveSelectedCount} selected foods`} tabIndex={leaving?-1:undefined}>
            <Trash2 size={18} aria-hidden="true"/><span>Delete</span>
          </Button>
        </>}
      </div>
    </aside>
  );
}

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
  onSelectAll,onDeselectAll,onEdit,onCopy,onMove,onDelete,
  onPaste,onPasteToToday,onPasteToTomorrow,onPasteDateAndTime,onBackFromCopy,onDone,
}:FoodSelectionBarProps){
  const copyMode=copiedCount>0;
  const allSelected=selectedCount>0&&selectedCount===totalCount;
  const count=copyMode?copiedCount:selectedCount;
  const calories=copyMode?copiedCalories:totalCalories;

  return (
    <aside className={`food-selection-bar${copyMode?' food-selection-bar-copy':''}`} aria-label="Bulk selection actions" role="toolbar">
      <div className="food-selection-bar-info">
        <strong className="food-selection-count">{copyMode?`${copiedCount} ${copiedCount===1?'food':'foods'} copied`:`${selectedCount} selected`}</strong>
        {count>0&&<span className="food-selection-calories">{displayEnergy(calories,energyUnit)} {energyLabel(energyUnit)}</span>}
      </div>
      <div className="food-selection-bar-tools">
        {copyMode?(
          onBackFromCopy&&<Button variant="tertiary" size="sm" onClick={onBackFromCopy} aria-label="Back to selection actions">
            <ArrowLeft size={16} aria-hidden="true"/><span>Back</span>
          </Button>
        ):(
          <Button variant="tertiary" size="sm" onClick={allSelected?onDeselectAll:onSelectAll} aria-label={allSelected?'Deselect all foods':'Select all foods'}>
            <CheckCheck size={16} aria-hidden="true"/><span>{allSelected?'Deselect all':'Select all'}</span>
          </Button>
        )}
        <Button variant="tertiary" size="icon" onClick={onDone} aria-label="Exit selection mode" title="Done">
          <X size={18} aria-hidden="true"/>
        </Button>
      </div>
      <div className="food-selection-bar-actions">
        {copyMode?<>
          <Button variant="primary" size="sm" onClick={onPaste} aria-label={copiedCount===1?'Paste copied food':`Paste ${copiedCount} copied foods`}>
            <ClipboardPaste size={18} aria-hidden="true"/><span>Paste</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onPasteToToday} aria-label="Paste to today">
            <Calendar size={18} aria-hidden="true"/><span className="tab-label-full">Paste to today</span><span className="tab-label-short">To today</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onPasteToTomorrow} aria-label="Paste to tomorrow">
            <CalendarPlus size={18} aria-hidden="true"/><span className="tab-label-full">Paste to tomorrow</span><span className="tab-label-short">Tomorrow</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={e=>onPasteDateAndTime?.(e.currentTarget)} aria-label="Paste to date and time">
            <Clock size={18} aria-hidden="true"/><span>Date & time</span>
          </Button>
        </>:<>
          {selectedCount===1&&onEdit&&<Button variant="secondary" size="sm" onClick={onEdit} aria-label="Edit selected food">
            <Pencil size={18} aria-hidden="true"/><span>Edit</span>
          </Button>}
          <Button variant="secondary" size="sm" disabled={selectedCount===0} onClick={onCopy} aria-label={selectedCount===1?'Copy selected food to clipboard':`Copy ${selectedCount} selected foods to clipboard`}>
            <Copy size={18} aria-hidden="true"/><span>Copy</span>
          </Button>
          <Button variant="secondary" size="sm" disabled={selectedCount===0} onClick={e=>onMove(e.currentTarget)} aria-label={selectedCount===1?'Move selected food':`Move ${selectedCount} selected foods`}>
            <MoveRight size={18} aria-hidden="true"/><span>Move</span>
          </Button>
          <Button variant="destructive" size="sm" disabled={selectedCount===0} onClick={e=>onDelete(e.currentTarget)} aria-label={selectedCount===1?'Delete selected food':`Delete ${selectedCount} selected foods`}>
            <Trash2 size={18} aria-hidden="true"/><span>Delete</span>
          </Button>
        </>}
      </div>
    </aside>
  );
}

import {Copy,MoveRight,Trash2,CheckCheck,X,Pencil} from 'lucide-react';
import {Button} from './ui/Button';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';

export interface FoodSelectionBarProps {
  selectedCount:number;
  totalCount:number;
  totalCalories:number;
  energyUnit?:EnergyUnit;
  onSelectAll:()=>void;
  onDeselectAll:()=>void;
  onEdit?:()=>void;
  onCopy:()=>void;
  onMove:(trigger:HTMLElement)=>void;
  onDelete:(trigger:HTMLElement)=>void;
  onDone:()=>void;
}

export function FoodSelectionBar({
  selectedCount,
  totalCount,
  totalCalories,
  energyUnit='kcal',
  onSelectAll,
  onDeselectAll,
  onEdit,
  onCopy,
  onMove,
  onDelete,
  onDone,
}:FoodSelectionBarProps){
  const allSelected=selectedCount>0&&selectedCount===totalCount;

  return (
    <aside className="food-selection-bar" aria-label="Bulk selection actions" role="toolbar">
      <div className="food-selection-bar-info">
        <strong className="food-selection-count">{selectedCount} selected</strong>
        {selectedCount>0&&<span className="food-selection-calories">
          {displayEnergy(totalCalories,energyUnit)} {energyLabel(energyUnit)}
        </span>}
      </div>
      <div className="food-selection-bar-tools">
        <Button
          variant="tertiary"
          size="sm"
          onClick={allSelected?onDeselectAll:onSelectAll}
          aria-label={allSelected?'Deselect all foods':'Select all foods'}
        >
          <CheckCheck size={16} aria-hidden="true"/>
          <span>{allSelected?'Deselect all':'Select all'}</span>
        </Button>
        <Button variant="tertiary" size="icon" onClick={onDone} aria-label="Exit selection mode" title="Done">
          <X size={18} aria-hidden="true"/>
        </Button>
      </div>
      <div className="food-selection-bar-actions">
        {selectedCount===1&&onEdit&&<Button variant="secondary" size="sm" onClick={onEdit} aria-label="Edit selected food">
          <Pencil size={18} aria-hidden="true"/>
          <span>Edit</span>
        </Button>}
        <Button
          variant="secondary"
          size="sm"
          disabled={selectedCount===0}
          onClick={onCopy}
          aria-label={selectedCount===1?'Copy selected food to clipboard':`Copy ${selectedCount} selected foods to clipboard`}
        >
          <Copy size={18} aria-hidden="true"/>
          <span>Copy</span>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={selectedCount===0}
          onClick={e=>onMove(e.currentTarget)}
          aria-label={selectedCount===1?'Move selected food':`Move ${selectedCount} selected foods`}
        >
          <MoveRight size={18} aria-hidden="true"/>
          <span>Move</span>
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={selectedCount===0}
          onClick={e=>onDelete(e.currentTarget)}
          aria-label={selectedCount===1?'Delete selected food':`Delete ${selectedCount} selected foods`}
        >
          <Trash2 size={18} aria-hidden="true"/>
          <span>Delete</span>
        </Button>
      </div>
    </aside>
  );
}

import {Copy,MoveRight,Trash2,CheckCheck,X} from 'lucide-react';
import {Button} from './ui/Button';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';

export interface FoodSelectionBarProps {
  selectedCount:number;
  totalCount:number;
  totalCalories:number;
  energyUnit?:EnergyUnit;
  onSelectAll:()=>void;
  onDeselectAll:()=>void;
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
  onCopy,
  onMove,
  onDelete,
  onDone,
}:FoodSelectionBarProps){
  const allSelected=selectedCount>0&&selectedCount===totalCount;

  return (
    <aside className="food-selection-bar" aria-label="Bulk selection actions" role="toolbar">
      <div className="food-selection-bar-content">
        <div className="food-selection-bar-info">
          <strong className="food-selection-count">
            {selectedCount} {selectedCount===1?'selected':'selected'}
          </strong>
          {selectedCount>0&&<span className="food-selection-calories">
            · {displayEnergy(totalCalories,energyUnit)} {energyLabel(energyUnit)}
          </span>}
        </div>
        <div className="food-selection-bar-actions">
          <Button
            variant="tertiary"
            size="sm"
            onClick={allSelected?onDeselectAll:onSelectAll}
            aria-label={allSelected?'Deselect all foods':'Select all foods'}
            title={allSelected?'Deselect all':'Select all'}
          >
            <CheckCheck size={16}/>
            <span>{allSelected?'Deselect all':'Select all'}</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={selectedCount===0}
            onClick={onCopy}
            aria-label={`Copy ${selectedCount} selected foods to clipboard`}
            title="Copy to clipboard"
          >
            <Copy size={16}/>
            <span>Copy</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={selectedCount===0}
            onClick={e=>onMove(e.currentTarget)}
            aria-label={`Move ${selectedCount} selected foods`}
            title="Move foods"
          >
            <MoveRight size={16}/>
            <span>Move</span>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={selectedCount===0}
            onClick={e=>onDelete(e.currentTarget)}
            aria-label={`Delete ${selectedCount} selected foods`}
            title="Delete foods"
          >
            <Trash2 size={16}/>
            <span>Delete</span>
          </Button>
          <Button
            variant="tertiary"
            size="icon"
            onClick={onDone}
            aria-label="Exit selection mode"
            title="Done"
          >
            <X size={18}/>
          </Button>
        </div>
      </div>
    </aside>
  );
}

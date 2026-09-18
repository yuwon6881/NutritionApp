import {Check,MoreHorizontal} from 'lucide-react';
import type {Entry} from '../types';
import {Button} from './ui/Button';
import {FoodMacroSummary} from './FoodMacroSummary';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';
import {displayPortion} from '../lib/portions';
import {useLongPress} from '../lib/useLongPress';

export interface FoodTimeCardProps {
  entry:Entry;
  energyUnit:EnergyUnit;
  readOnly:boolean;
  isSelecting:boolean;
  isSelected:boolean;
  isMoved:boolean;
  pendingError?:string;
  isPendingSync:boolean;
  onEdit:(entry:Entry)=>void;
  onOpenActions:(entry:Entry,trigger:HTMLElement)=>void;
  onToggleSelect:(id:string)=>void;
  onLongPressSelect:(id:string)=>void;
  dragProps:Record<string,unknown>;
}

export function FoodTimeCard({
  entry,
  energyUnit,
  readOnly,
  isSelecting,
  isSelected,
  isMoved,
  pendingError,
  isPendingSync,
  onEdit,
  onOpenActions,
  onToggleSelect,
  onLongPressSelect,
  dragProps,
}:FoodTimeCardProps){
  const {handlers,hasTriggered}=useLongPress({
    onLongPress:()=>onLongPressSelect(entry.id),
    disabled:readOnly||isSelecting,
  });

  const handleCardClick=()=>{
    if(hasTriggered())return;
    if(isSelecting){
      onToggleSelect(entry.id);
    }
  };

  return (
    <article
      className={`panel food-time-card ${isMoved?'food-time-card-moved':''} ${isSelected?'food-time-card-selected':''}`.trim()}
      data-selected={isSelected?true:undefined}
      onClick={isSelecting?handleCardClick:undefined}
      {...(isSelecting?{}:{...dragProps,...handlers})}
    >
      <div className="food-time-card-header">
        {isSelecting&&<div
          className={`food-card-select-checkbox ${isSelected?'checked':''}`}
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Select ${entry.name}`}
          tabIndex={0}
          onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();onToggleSelect(entry.id);}}}
        >
          {isSelected&&<Check size={14} className="food-check-icon"/>}
        </div>}
        <h3 className="food-time-card-title">
          <Button
            variant="tertiary"
            disabled={readOnly}
            onClick={e=>{
              if(isSelecting){
                e.stopPropagation();
                onToggleSelect(entry.id);
              }else{
                onEdit(entry);
              }
            }}
          >
            {entry.name}
          </Button>
        </h3>
        <div className="food-time-card-aside">
          <strong className="food-time-card-energy">
            {displayEnergy(entry.calories,energyUnit)} <small>{energyLabel(energyUnit)}</small>
          </strong>
          {!isSelecting&&<Button
            variant="tertiary"
            size="icon"
            className="food-time-card-more"
            disabled={readOnly}
            aria-label={`More actions for ${entry.name}`}
            title="More actions"
            onClick={event=>onOpenActions(entry,event.currentTarget)}
          >
            <MoreHorizontal size={19}/>
          </Button>}
        </div>
      </div>
      <div className="food-time-card-details">
        <span className="food-time-card-portion">{displayPortion(entry)}</span>
        <span className="food-time-card-dot" aria-hidden="true">·</span>
        <FoodMacroSummary protein={entry.protein} carbs={entry.carbs} fat={entry.fat} fiber={entry.fiber} includeFiber/>
      </div>
      {isPendingSync&&<small className="sync-label" role="status">{pendingError??'Pending sync'}</small>}
    </article>
  );
}

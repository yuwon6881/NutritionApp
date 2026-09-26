import {memo,type CSSProperties} from 'react';
import {Check,Copy,MoreHorizontal,MoveRight,Trash2} from 'lucide-react';
import type {Entry} from '../types';
import {Button} from './ui/Button';
import {FoodMacroSummary} from './FoodMacroSummary';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';
import {displayPortion} from '../lib/portions';

export interface FoodTimeCardProps {
  entry:Entry;
  energyUnit:EnergyUnit;
  readOnly:boolean;
  isSelecting:boolean;
  isSelected:boolean;
  isMoved:boolean;
  isAdded?:boolean;
  pendingError?:string;
  isPendingSync:boolean;
  onEdit:(entry:Entry)=>void;
  onOpenActions:(entry:Entry,trigger:HTMLElement)=>void;
  onToggleSelect:(id:string)=>void;
  dragProps:Record<string,unknown>;
  /** Touch swipe state from the timeline: offset in px (≤ 0) and whether actions are open. */
  swipe?:{offset:number;dragging:boolean;revealed:boolean};
  onCopy?:(entry:Entry,trigger:HTMLElement)=>void;
  onMove?:(entry:Entry,trigger:HTMLElement)=>void;
  onDelete?:(entry:Entry)=>void;
}

export const FoodTimeCard=memo(function FoodTimeCard({
  entry,
  energyUnit,
  readOnly,
  isSelecting,
  isSelected,
  isMoved,
  isAdded=false,
  pendingError,
  isPendingSync,
  onEdit,
  onOpenActions,
  onToggleSelect,
  dragProps,
  swipe,
  onCopy,
  onMove,
  onDelete,
}:FoodTimeCardProps){
  // Touch hold (select or drag) and mouse drag are one gesture owned by the
  // timeline; see useTimelineDrag. Nothing competes for the same pointer.
  const pointerProps=isSelecting?{}:dragProps;

  const showActions=Boolean(swipe&&(swipe.revealed||swipe.offset<0));
  return <div
    className={`food-card-swipe${swipe?.dragging?' swiping':''}`}
    data-swipe-id={entry.id}
    data-revealed={swipe?.revealed?true:undefined}
    style={{'--swipe-x':`${swipe?.offset??0}px`} as CSSProperties}
  >
    {showActions&&!isSelecting&&!readOnly&&<div className="food-card-swipe-actions" inert={!swipe?.revealed||undefined}>
      <Button variant="secondary" size="sm" onClick={event=>onCopy?.(entry,event.currentTarget)}><Copy size={16} aria-hidden="true"/>Copy</Button>
      <Button variant="secondary" size="sm" onClick={event=>onMove?.(entry,event.currentTarget)}><MoveRight size={16} aria-hidden="true"/>Move</Button>
      <Button variant="destructive" size="sm" aria-label={`Delete ${entry.name}`} onClick={()=>onDelete?.(entry)}><Trash2 size={16} aria-hidden="true"/>Delete</Button>
    </div>}
    <article
      className={`panel food-time-card ${isMoved?'food-time-card-moved':''} ${isAdded?'food-time-card-added':''} ${isSelected?'food-time-card-selected':''}`.trim()}
      data-selected={isSelected?true:undefined}
      onClick={isSelecting?()=>onToggleSelect(entry.id):undefined}
      {...pointerProps}
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
        <FoodMacroSummary protein={entry.protein} carbs={entry.carbs} fat={entry.fat}/>
      </div>
      {isPendingSync&&<small className="sync-label" role="status">{pendingError??'Pending sync'}</small>}
    </article>
  </div>;
});

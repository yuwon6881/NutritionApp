import {memo} from 'react';
import {Check,Flame} from 'lucide-react';
import type {Entry} from '../types';
import {FoodMacroSummary} from './FoodMacroSummary';
import {displayEnergy,energyLabel,type EnergyUnit} from '../lib/units';
import {displayMass,displayPortion} from '../lib/portions';

export interface FoodTimeCardProps {
  entry:Entry;
  energyUnit:EnergyUnit;
  isSelecting:boolean;
  /** Selection just ended: the checkbox plays its exit animation without taking input. */
  checkboxLeaving?:boolean;
  /** Selection ended to open the editor: the card holds its selected look, unanimated, until the dialog covers it. */
  selectionHeld?:boolean;
  isSelected:boolean;
  isMoved:boolean;
  isAdded?:boolean;
  isPendingSync:boolean;
  onEdit?:(entry:Entry)=>void;
  onToggleSelect:(id:string)=>void;
  dragProps:Record<string,unknown>;
}

export const FoodTimeCard=memo(function FoodTimeCard({
  entry,
  energyUnit,
  isSelecting,
  checkboxLeaving=false,
  selectionHeld=false,
  isSelected,
  isMoved,
  isAdded=false,
  isPendingSync,
  onEdit,
  onToggleSelect,
  dragProps,
}:FoodTimeCardProps){
  // Touch hold (select or drag) and mouse drag are one gesture owned by the
  // timeline; see useTimelineDrag. Nothing competes for the same pointer.
  const pointerProps=isSelecting?{}:dragProps;

  // A plain tap, click, or Enter/Space opens the editor. Hold and drag are owned by the
  // timeline gesture (the drag hook swallows the click a mouse release would add).
  const editable=Boolean(onEdit)&&!isSelecting;
  const showCheckbox=isSelecting||checkboxLeaving||selectionHeld;
  return <article
      className={`panel food-time-card ${isMoved?'food-time-card-moved':''} ${isAdded?'food-time-card-added':''} ${isSelected?'food-time-card-selected':''} ${showCheckbox?'food-time-card-selecting':''} ${checkboxLeaving?'food-time-card-leaving':''}`.trim()}
      data-selected={isSelected?true:undefined}
      tabIndex={editable?0:undefined}
      aria-label={editable?`Edit ${entry.name}`:undefined}
      onClick={isSelecting?()=>onToggleSelect(entry.id):editable?()=>onEdit?.(entry):undefined}
      onKeyDown={editable?event=>{
        if(event.target!==event.currentTarget||(event.key!==' '&&event.key!=='Enter'))return;
        event.preventDefault();
        onEdit?.(entry);
      }:undefined}
      {...pointerProps}
    >
      <div className="food-time-card-header">
        {showCheckbox&&<div
          className={`food-card-select-checkbox ${isSelected?'checked':''} ${checkboxLeaving?'leaving':''}`.trim()}
          role={isSelecting?'checkbox':undefined}
          aria-checked={isSelecting?isSelected:undefined}
          aria-label={isSelecting?`Select ${entry.name}`:undefined}
          aria-hidden={!isSelecting?true:undefined}
          tabIndex={isSelecting?0:undefined}
          onKeyDown={isSelecting?e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();onToggleSelect(entry.id);}}:undefined}
        >
          {isSelected&&<Check size={14} className="food-check-icon"/>}
        </div>}
        <h3 className="food-time-card-title">
          <span className="food-time-card-title-text">{entry.name}</span>
        </h3>
        {/* Phones show this one short measure and place the energy before the macros, so every
            card keeps the same two-line shape; wider windows show the full portion instead and
            give the energy its own column. The card grid places each piece per tier. */}
        <span className="food-time-card-mass">{displayMass(entry)}</span>
        <div className="food-time-card-aside">
          <strong className="food-time-card-energy">
            <Flame size={13} aria-hidden="true"/>{displayEnergy(entry.calories,energyUnit)} <small>{energyLabel(energyUnit)}</small>
          </strong>
        </div>
      </div>
      <div className="food-time-card-details">
        <span className="food-time-card-portion">{displayPortion(entry)}</span>
        <FoodMacroSummary protein={entry.protein} carbs={entry.carbs} fat={entry.fat}/>
      </div>
      {isPendingSync&&<small className="sync-label" role="status">Pending sync</small>}
    </article>;
});

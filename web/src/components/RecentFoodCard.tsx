import {memo,type CSSProperties} from 'react';
import type {EnergyUnit,Entry} from '../types';
import {displayPortion} from '../lib/portions';
import {displayEnergy,energyLabel} from '../lib/units';
import {Button} from './ui/Button';
import {FoodMacroSummary} from './FoodMacroSummary';

export const RecentFoodCard=memo(function RecentFoodCard({
  entry,
  energyUnit,
  disabled=false,
  index,
  onSelect
}:{
  entry:Entry;
  energyUnit:EnergyUnit;
  disabled?:boolean;
  /** Position in its list; staggers the entrance of the first few cards. */
  index?:number;
  onSelect:(entry:Entry,trigger:HTMLElement)=>void;
}){
  return <Button
    presentation="plain"
    className="recent-food-card"
    style={index==null?undefined:{'--i':Math.min(index,8)} as CSSProperties}
    disabled={disabled}
    aria-label={`${entry.name}, ${displayPortion(entry)}, ${displayEnergy(entry.calories,energyUnit)} ${energyLabel(energyUnit)}`}
    onClick={event=>onSelect(entry,event.currentTarget)}
  >
    <div className="recent-food-info">
      <strong className="recent-food-name" title={entry.name}>{entry.name}</strong>
      <span className="recent-food-portion">{displayPortion(entry)}</span>
    </div>
    <div className="recent-food-meta">
      <strong className="recent-food-energy">
        {displayEnergy(entry.calories,energyUnit)} <small>{energyLabel(energyUnit)}</small>
      </strong>
      {(entry.protein!=null||entry.carbs!=null||entry.fat!=null)&&<FoodMacroSummary protein={entry.protein} carbs={entry.carbs} fat={entry.fat} className="recent-food-macros"/>}
    </div>
  </Button>;
});

import type {EnergyUnit,Entry} from '../types';
import {displayPortion} from '../lib/portions';
import {displayEnergy,energyLabel} from '../lib/units';
import {Button} from './ui/Button';

export function RecentFoodCard({
  entry,
  energyUnit,
  disabled=false,
  onSelect
}:{
  entry:Entry;
  energyUnit:EnergyUnit;
  disabled?:boolean;
  onSelect:(entry:Entry,trigger:HTMLElement)=>void;
}){
  return <Button
    presentation="plain"
    className="recent-food-card"
    disabled={disabled}
    aria-label={`${entry.name}, ${displayPortion(entry)}, ${displayEnergy(entry.calories,energyUnit)} ${energyLabel(energyUnit)}`}
    onClick={event=>onSelect(entry,event.currentTarget)}
  >
    <div className="recent-food-info">
      <strong className="recent-food-name">{entry.name}</strong>
      <span className="recent-food-portion">{displayPortion(entry)}</span>
    </div>
    <strong className="recent-food-energy">
      {displayEnergy(entry.calories,energyUnit)} <small>{energyLabel(energyUnit)}</small>
    </strong>
  </Button>;
}

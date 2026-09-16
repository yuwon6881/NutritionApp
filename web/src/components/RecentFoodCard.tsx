import type {EnergyUnit,Entry} from '../types';
import {displayPortion} from '../lib/portions';
import {displayEnergy,energyLabel} from '../lib/units';
import {Button} from './ui/Button';

export function RecentFoodCard({
  entry,
  energyUnit,
  onSelect
}:{
  entry:Entry;
  energyUnit:EnergyUnit;
  onSelect:(entry:Entry)=>void;
}){
  return <Button
    presentation="plain"
    className="recent-food-card"
    onClick={()=>onSelect(entry)}
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

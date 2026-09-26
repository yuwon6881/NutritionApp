import type {EnergyUnit,Entry} from '../types';
import {RecentFoodCard} from './RecentFoodCard';

/** Recent and frequent foods shown before a search, one tap from the batch review. */
export function LogFoodRecents({entries,energyUnit,onPick}:{entries:Entry[];energyUnit:EnergyUnit;onPick:(entry:Entry)=>void}){
  if(!entries.length)return null;
  return <section className="recent-foods-section" aria-labelledby="search-recent-heading">
    <div className="recent-foods-heading">
      <h4 id="search-recent-heading">Recent and frequent</h4>
      <small>Tap to review with your last portion</small>
    </div>
    <div className="recent-foods-grid">
      {entries.map(entry=><RecentFoodCard key={entry.id} entry={entry} energyUnit={energyUnit} onSelect={onPick}/>)}
    </div>
  </section>;
}

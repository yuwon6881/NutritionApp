import type {EnergyUnit,Entry} from '../types';
import {RecentFoodCard} from './RecentFoodCard';

/**
 * The Dashboard's shortest path to re-logging: a frequent food opens the
 * batch review with that food and its last portion already added.
 */
export function LogAgainStrip({entries,energyUnit,disabled,onLog}:{entries:Entry[];energyUnit:EnergyUnit;disabled:boolean;onLog:(entry:Entry,trigger:HTMLElement)=>void}){
  if(!entries.length)return null;
  return <section className="panel log-again-panel" aria-labelledby="log-again-title">
    <div className="section-heading">
      <div><h2 id="log-again-title">Log again</h2><p>Your recent and frequent foods, at the portion you last logged.</p></div>
    </div>
    <div className="log-again-strip">
      {entries.map(entry=><RecentFoodCard key={entry.id} entry={entry} energyUnit={energyUnit} disabled={disabled} onSelect={(selected,trigger)=>onLog(selected,trigger)}/>)}
    </div>
  </section>;
}

import type {EnergyUnit,Entry} from '../types';
import type {RecentFoodSections} from '../lib/recentFoodSections';
import {RecentFoodCard} from './RecentFoodCard';

/** Foods shown before a search, one tap from the batch review: the ones usually logged around
 *  this time of day, then the latest other foods. */
export function LogFoodRecents({sections,energyUnit,onPick}:{sections:RecentFoodSections;energyUnit:EnergyUnit;onPick:(entry:Entry)=>void}){
  const {aroundNow,latest}=sections;
  if(!aroundNow.length&&!latest.length)return null;
  const group=(id:string,title:string,entries:Entry[],offset:number)=>entries.length>0&&<div className="recent-foods-group" role="group" aria-labelledby={id}>
    <h5 id={id} className="recent-foods-subheading">{title}</h5>
    <div className="recent-foods-grid">
      {entries.map((entry,index)=><RecentFoodCard key={entry.id} index={offset+index} entry={entry} energyUnit={energyUnit} onSelect={onPick}/>)}
    </div>
  </div>;
  return <section className="recent-foods-section" aria-labelledby="search-recent-heading">
    <div className="recent-foods-heading">
      <h4 id="search-recent-heading">Recent and frequent</h4>
      <small>Tap to review with your last portion</small>
    </div>
    {group('search-recent-now-heading','Usually around now',aroundNow,0)}
    {group('search-recent-latest-heading','Latest',latest,aroundNow.length)}
  </section>;
}

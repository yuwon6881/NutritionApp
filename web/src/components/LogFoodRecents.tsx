import type {EnergyUnit,Entry} from '../types';
import {picksHourLabel,type RecentFoodSections} from '../lib/recentFoodSections';
import {RecentFoodCard} from './RecentFoodCard';

/** Foods shown before a search, one tap from the batch review: the ones usually logged around
 *  this time of day under their own "12 PM picks" heading, then recent and frequent foods. */
export function LogFoodRecents({sections,minutes,energyUnit,onPick}:{sections:RecentFoodSections;minutes:number;energyUnit:EnergyUnit;onPick:(entry:Entry)=>void}){
  const {aroundNow,latest}=sections;
  if(!aroundNow.length&&!latest.length)return null;
  const hour=picksHourLabel(minutes);
  const grid=(entries:Entry[],offset:number)=><div className="recent-foods-grid">
    {entries.map((entry,index)=><RecentFoodCard key={entry.id} index={offset+index} entry={entry} energyUnit={energyUnit} onSelect={onPick}/>)}
  </div>;
  return <>
    {aroundNow.length>0&&<section className="recent-foods-section recent-foods-picks" aria-labelledby="search-picks-heading">
      <div className="recent-foods-heading">
        <h4 id="search-picks-heading">{hour} picks</h4>
      </div>
      {grid(aroundNow,0)}
    </section>}
    {latest.length>0&&<section className="recent-foods-section" aria-labelledby="search-recent-heading">
      <div className="recent-foods-heading">
        <h4 id="search-recent-heading">Recent and frequent</h4>
        <small>Tap to review with your last portion</small>
      </div>
      <div className="recent-foods-group" role="group" aria-labelledby="search-recent-latest-heading">
        <h5 id="search-recent-latest-heading" className="recent-foods-subheading">Latest</h5>
        {grid(latest,aroundNow.length)}
      </div>
    </section>}
  </>;
}

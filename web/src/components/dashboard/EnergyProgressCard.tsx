import {useState} from 'react';
import type {NutritionStore} from '../../useNutritionStore';
import type {ProgressPeriod} from '../../types';
import {today} from '../../lib/format';
import {unitsFor} from '../../lib/units';
import {progressPeriodOptions,progressRange} from '../../lib/progress';
import {SelectField} from '../ui/Field';
import {SwipeCarousel,type CarouselSlide} from '../ui/SwipeCarousel';
import {useDelayedPending} from '../ui/useDelayedPending';
import {EnergyBalance} from '../EnergyBalance';
import {MaintenanceChart} from '../MaintenanceChart';
import {CoachingProgress} from '../CoachingProgress';
import {useProgressSummary} from '../../useProgressSummary';

/**
 * Energy over a chosen period: swipe between logged intake against maintenance, the surplus or
 * deficit it leaves, the maintenance estimate itself, and the coach's guidance.
 */
export function EnergyProgressCard({store}:{store:NutritionStore}){
  const [period,setPeriod]=useState<ProgressPeriod>('month');
  const energy=useProgressSummary(store,period);
  const pending=useDelayedPending(energy.loading&&Boolean(energy.summary));
  const state=store.state!;
  const units=unitsFor(state.settings);
  const range=energy.summary??progressRange(energy.displayedPeriod,today(state.profile?.timeZone),state.start);
  const balance=(view:'intake'|'balance')=><EnergyBalance store={store} view={view} period={energy.displayedPeriod} summary={energy.summary} error={energy.error}/>;
  const slides:CarouselSlide[]=[
    {id:'intake',ariaLabel:'Intake and maintenance',content:balance('intake')},
    {id:'balance',ariaLabel:'Surplus or deficit',content:balance('balance')},
    {id:'maintenance',ariaLabel:'Estimated maintenance',content:<MaintenanceChart points={state.energyEstimates??[]} energyUnit={units.energy} rangeStart={range.start} rangeEnd={range.end}/>},
    {id:'coaching',ariaLabel:'Coaching guidance',content:<CoachingProgress store={store} rangeStart={range.start} rangeEnd={range.end}/>},
  ];
  return <section className="panel dashboard-wide-card energy-progress-card" aria-labelledby="dashboard-energy-title" data-pending={pending||undefined}>
    <div className="dashboard-card-head"><h3 id="dashboard-energy-title" className="dashboard-card-title">Energy</h3></div>
    <SwipeCarousel label="Energy view" slides={slides} toolbar={<SelectField className="select-compact" label="Energy history period" value={period} onChange={value=>setPeriod(value as ProgressPeriod)}>
      {progressPeriodOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </SelectField>}/>
  </section>;
}

import {useEffect,useState} from 'react';
import type {NutritionStore} from '../../useNutritionStore';
import type {EnergyChartView,ProgressPeriod} from '../../types';
import {today} from '../../lib/format';
import {unitsFor} from '../../lib/units';
import {progressPeriodOptions,progressRange} from '../../lib/progress';
import {SelectField} from '../ui/Field';
import {SwipeCarousel,type CarouselSlide} from '../ui/SwipeCarousel';
import {useDelayedPending} from '../ui/useDelayedPending';
import {useBarViewport} from '../ui/useBarViewport';
import {EnergyBalance} from '../EnergyBalance';
import {MaintenanceChart} from '../MaintenanceChart';
import {CoachingProgress} from '../CoachingProgress';
import {useProgressSummary} from '../../useProgressSummary';

/**
 * Energy over a chosen period: swipe between logged intake against maintenance, the surplus or
 * deficit it leaves, the maintenance estimate itself, and the coach's guidance.
 */
export function EnergyProgressCard({store,view:controlledView,onView:onControlledView,period:controlledPeriod,onPeriod:onControlledPeriod}:{store:NutritionStore;view?:EnergyChartView;onView?:(view:EnergyChartView)=>void;period?:ProgressPeriod;onPeriod?:(period:ProgressPeriod)=>void}){
  const state=store.state!;
  const [internalPeriod,setInternalPeriod]=useState<ProgressPeriod>(()=>(state.settings?.energyPeriod as ProgressPeriod)??'month');
  const period=controlledPeriod??internalPeriod;
  const energy=useProgressSummary(store,period);
  const pending=useDelayedPending(energy.loading&&Boolean(energy.summary));
  const units=unitsFor(state.settings);
  const range=energy.summary??progressRange(energy.displayedPeriod,today(state.profile?.timeZone),state.start);

  useEffect(()=>{
    const saved=state.settings?.energyPeriod as ProgressPeriod|undefined;
    if(saved&&saved!==internalPeriod)setInternalPeriod(saved);
  },[state.settings?.energyPeriod]);

  const handlePeriodChange=(nextPeriod:ProgressPeriod)=>{
    onControlledPeriod?.(nextPeriod);
    setInternalPeriod(nextPeriod);
    if(!controlledPeriod&&nextPeriod!==state.settings?.energyPeriod){
      void store.mutate({
        kind:'settings',
        recordId:state.id,
        expectedRevision:state.settings?.revision??0,
        data:{energyPeriod:nextPeriod},
        delete:false
      });
    }
  };

  const savedView=state.settings?.energyChartView??'intake';
  const activeView=controlledView??savedView;

  const handleViewChange=(newView:string)=>{
    onControlledView?.(newView as EnergyChartView);
    if(!controlledView&&newView!==savedView){
      void store.mutate({
        kind:'settings',
        recordId:state.id,
        expectedRevision:state.settings?.revision??0,
        data:{energyChartView:newView as EnergyChartView},
        delete:false
      });
    }
  };

  const rows=energy.summary?.energy.series??[];
  const viewport=useBarViewport(rows.length);
  const [scrubIndex,setScrubIndex]=useState<number>();

  const balance=(view:'intake'|'balance')=><EnergyBalance store={store} view={view} period={energy.displayedPeriod} summary={energy.summary} error={energy.error} viewport={viewport} selectedIndex={scrubIndex} onSelectIndex={setScrubIndex}/>;
  const slides:CarouselSlide[]=[
    {id:'intake',ariaLabel:'Intake and maintenance',content:balance('intake')},
    {id:'balance',ariaLabel:'Surplus or deficit',content:balance('balance')},
    {id:'maintenance',ariaLabel:'Estimated maintenance',content:<MaintenanceChart points={state.energyEstimates??[]} energyUnit={units.energy} rangeStart={range.start} rangeEnd={range.end}/>},
    {id:'coaching',ariaLabel:'Coaching guidance',content:<CoachingProgress store={store} rangeStart={range.start} rangeEnd={range.end}/>},
  ];
  return <section className="panel dashboard-wide-card energy-progress-card" aria-labelledby="dashboard-energy-title" data-pending={pending||undefined}>
    <div className="dashboard-card-head"><h3 id="dashboard-energy-title" className="dashboard-card-title">Energy</h3></div>
    <SwipeCarousel label="Energy view" slides={slides} activeId={activeView} onChange={handleViewChange} toolbar={<SelectField className="select-compact" label="Energy history period" value={period} onChange={value=>handlePeriodChange(value as ProgressPeriod)}>
      {progressPeriodOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </SelectField>}/>
  </section>;
}

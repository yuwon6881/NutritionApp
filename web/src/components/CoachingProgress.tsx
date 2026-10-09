import type {NutritionStore} from '../useNutritionStore';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {useChartLayout} from './ui/useChartLayout';
import {mediumDate} from '../lib/format';

function lineSegments(points:{date:string;value:number|null}[],x:(date:string)=>number,y:(value:number)=>number){
  const segments:string[][]=[];let current:string[]=[];
  for(const point of points){
    if(point.value==null){if(current.length)segments.push(current);current=[];continue;}
    current.push(`${x(point.date)},${y(point.value)}`);
  }
  if(current.length)segments.push(current);
  return segments;
}

export function CoachingProgress({store}:{store:NutritionStore}){
  const chart=useChartLayout();
  const state=store.state!;
  const units=unitsFor(state.settings);
  const energyUnit=energyLabel(units.energy);
  const points=(state.energyEstimates??[]).filter(point=>point.expenditure!=null).sort((a,b)=>a.date.localeCompare(b.date));
  const values=points.flatMap(point=>[point.expenditure,point.suggestedCalories].filter((value):value is number=>value!=null));
  const accepted=state.acceptedTargetIntervals??[];
  const allValues=[...values,...accepted.flatMap(interval=>interval.dailyCalories??(interval.calories==null?[]:[interval.calories]))];
  const min=(allValues.length?Math.min(...allValues):2000)-100;
  const max=(allValues.length?Math.max(...allValues):2500)+100;
  const start=points[0]?.date??state.start;
  const end=points.at(-1)?.date??state.end;
  const duration=Math.max(1,Date.parse(end)-Date.parse(start));
  const x=(date:string)=>chart.left+(Date.parse(date)-Date.parse(start))/duration*chart.plotWidth;
  const y=(value:number)=>185-(value-min)/Math.max(1,max-min)*130;
  const maintenance=lineSegments(points.map(point=>({date:point.date,value:point.expenditure})),x,y);
  const goal=lineSegments(points.map(point=>({date:point.date,value:point.suggestedCalories})),x,y);
  return <section className="panel coaching-progress">
    <div className="section-heading">
      <div>
        <h2>Coaching guidance</h2>
        <p className="chart-description">Estimated daily burn rate alongside suggested and accepted calorie targets over time.</p>
      </div>
    </div>
    {!points.length?<p className="notice">Not enough data yet.</p>:<>
      <svg ref={chart.ref} viewBox={`0 0 ${chart.width} 245`} className="weight-chart" role="img" aria-label="Continuous maintenance and provisional goal calorie guidance with accepted target intervals. Missing values remain unplotted.">
        <line x1={chart.left} y1="185" x2={chart.right} y2="185" className="chart-grid"/>
        {accepted.map(interval=>{const target=interval.calories??(interval.dailyCalories?.length?interval.dailyCalories.reduce((sum,value)=>sum+value,0)/7:null);return target==null?null:<line key={interval.start} x1={x(interval.start)} x2={x(interval.end>end?end:interval.end)} y1={y(target)} y2={y(target)} className="accepted-target-line"><title>{mediumDate(interval.start)} to {mediumDate(interval.end)}: accepted target {displayEnergy(target,units.energy)} {energyUnit}/day (active plan)</title></line>;})}
        {maintenance.map((segment,index)=><polyline key={`maintenance-${index}`} className="trend-line" points={segment.join(' ')}><title>Maintenance: estimated daily energy expenditure to keep weight steady</title></polyline>)}
        {goal.map((segment,index)=><polyline key={`goal-${index}`} className="goal-trend-line" points={segment.join(' ')}><title>Provisional goal: suggested daily intake calculated by coach</title></polyline>)}
        <text x={chart.left-8} y="55" textAnchor="end">{displayEnergy(max,units.energy)}</text><text x={chart.left-8} y="185" textAnchor="end">{displayEnergy(min,units.energy)}</text>
        <text x={chart.left} y="220">{mediumDate(start)}</text><text x={chart.right} y="220" textAnchor="end">{mediumDate(end)}</text>
      </svg>
      <ul className="chart-legend coaching-legend" aria-label="Coaching guidance key">
        <li>
          <span className="legend-line swatch-coaching-maintenance" aria-hidden="true"/>
          <span>Maintenance <span className="legend-hint">(burn rate)</span></span>
        </li>
        <li>
          <span className="legend-line swatch-coaching-goal" aria-hidden="true"/>
          <span>Provisional goal <span className="legend-hint">(suggested)</span></span>
        </li>
        <li>
          <span className="legend-line swatch-coaching-accepted" aria-hidden="true"/>
          <span>Accepted target <span className="legend-hint">(active plan)</span></span>
        </li>
      </ul>
    </>}
  </section>;
}

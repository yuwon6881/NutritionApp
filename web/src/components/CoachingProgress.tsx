import type {NutritionStore} from '../useNutritionStore';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {useChartLayout} from './ui/useChartLayout';
import {mediumDate} from '../lib/format';
import {acceptedLineSpan,filterPointsToRange} from '../lib/coachingChart';

function lineSegments(points:{date:string;value:number|null}[],x:(date:string)=>number,y:(value:number)=>number){
  const segments:string[][]=[];let current:string[]=[];
  for(const point of points){
    if(point.value==null){if(current.length)segments.push(current);current=[];continue;}
    current.push(`${x(point.date)},${y(point.value)}`);
  }
  if(current.length)segments.push(current);
  return segments;
}

export function CoachingProgress({store,rangeStart,rangeEnd}:{store:NutritionStore;rangeStart?:string;rangeEnd?:string}){
  const chart=useChartLayout();
  const state=store.state!;
  const units=unitsFor(state.settings);
  const energyUnit=energyLabel(units.energy);
  const rawPoints=(state.energyEstimates??[]).filter(point=>point.expenditure!=null||point.suggestedCalories!=null).sort((a,b)=>a.date.localeCompare(b.date));
  const points=filterPointsToRange(rawPoints,rangeStart,rangeEnd);
  const values=points.flatMap(point=>[point.expenditure,point.suggestedCalories].filter((value):value is number=>value!=null));
  const accepted=state.acceptedTargetIntervals??[];
  const allValues=[...values,...accepted.flatMap(interval=>interval.dailyCalories??(interval.calories==null?[]:[interval.calories]))];
  // Round outward to whole 250s so the axis reads 1,750 / 2,000 / 2,250 rather than the data's own extremes.
  const min=Math.floor(((allValues.length?Math.min(...allValues):2000)-100)/250)*250;
  const max=Math.ceil(((allValues.length?Math.max(...allValues):2500)+100)/250)*250;
  const ticks=[min,(min+max)/2,max];
  const start=rangeStart??points[0]?.date??state.start;
  const end=rangeEnd??points.at(-1)?.date??state.end;
  const duration=Math.max(1,Date.parse(end)-Date.parse(start));
  const x=(date:string)=>chart.left+(Date.parse(date)-Date.parse(start))/duration*chart.plotWidth;
  const y=(value:number)=>185-(value-min)/Math.max(1,max-min)*130;
  const maintenance=lineSegments(points.map(point=>({date:point.date,value:point.expenditure})),x,y);
  const goal=lineSegments(points.map(point=>({date:point.date,value:point.suggestedCalories})),x,y);
  const acceptedDrawn=accepted.map(interval=>(interval.calories??(interval.dailyCalories?.length?interval.dailyCalories.reduce((sum,value)=>sum+value,0)/7:null))!=null&&(interval.end>=start&&interval.start<=end));
  const hasAccepted=acceptedDrawn.some(Boolean);
  const hasMaintenance=maintenance.length>0;
  const hasGoal=goal.length>0;
  const hasLegend=hasMaintenance||hasGoal||hasAccepted;
  return <section className="panel coaching-progress">
    <div className="section-heading">
      <div>
        <h2>Coaching guidance</h2>
        <p className="chart-description">Estimated daily burn rate alongside suggested and accepted calorie targets over time.</p>
      </div>
    </div>
    {points.length<2?<p className="notice">Not enough data yet.</p>:<>
      <svg ref={chart.ref} viewBox={`0 0 ${chart.width} 245`} className="weight-chart" role="img" aria-label="Continuous maintenance and provisional goal calorie guidance with accepted target intervals. Missing values remain unplotted.">
        {ticks.map(value=><g key={value}><line x1={chart.left} y1={y(value)} x2={chart.right} y2={y(value)} className="chart-grid"/><text x={chart.left-8} y={y(value)+4} textAnchor="end">{displayEnergy(value,units.energy)}</text></g>)}
        {accepted.map(interval=>{const target=interval.calories??(interval.dailyCalories?.length?interval.dailyCalories.reduce((sum,value)=>sum+value,0)/7:null);if(target==null||interval.end<start||interval.start>end)return null;const clampedStart=interval.start<start?start:interval.start;const clampedEnd=interval.end>end?end:interval.end;const [x1,x2]=acceptedLineSpan(x(clampedStart),x(clampedEnd),chart.left);return <line key={interval.start} x1={x1} x2={x2} y1={y(target)} y2={y(target)} className="accepted-target-line"><title>{mediumDate(interval.start)} to {mediumDate(interval.end)}: accepted target {displayEnergy(target,units.energy)} {energyUnit}/day (active plan)</title></line>;})}
        {maintenance.map((segment,index)=><polyline key={`maintenance-${index}`} className="trend-line" points={segment.join(' ')}><title>Maintenance: estimated daily energy expenditure to keep weight steady</title></polyline>)}
        {goal.map((segment,index)=><polyline key={`goal-${index}`} className="goal-trend-line" points={segment.join(' ')}><title>Provisional goal: suggested daily intake calculated by coach</title></polyline>)}
        <text x={chart.left} y="220">{mediumDate(start)}</text><text x={chart.right} y="220" textAnchor="end">{mediumDate(end)}</text>
      </svg>
      {hasLegend&&<ul className="chart-legend coaching-legend" aria-label="Coaching guidance key">
        {hasMaintenance&&<li>
          <span className="legend-line swatch-coaching-maintenance" aria-hidden="true"/>
          <span>Maintenance <span className="legend-hint">(burn rate)</span></span>
        </li>}
        {hasGoal&&<li>
          <span className="legend-line swatch-coaching-goal" aria-hidden="true"/>
          <span>Provisional goal <span className="legend-hint">(suggested)</span></span>
        </li>}
        {hasAccepted&&<li>
          <span className="legend-line swatch-coaching-accepted" aria-hidden="true"/>
          <span>Accepted target <span className="legend-hint">(active plan)</span></span>
        </li>}
      </ul>}
    </>}
  </section>;
}

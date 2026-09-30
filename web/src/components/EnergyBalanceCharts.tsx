import type {ProgressEnergyBucket,EnergyUnit} from '../types';
import {displayEnergy,energyLabel} from '../lib/units';
import {niceStep,niceTicks,steppedPath} from '../lib/barChart';
import {bucketAxisLabel,type BucketGrouping} from '../lib/chartLabels';
import {BAR_AXIS_WIDTH,BarChartFrame} from './ui/BarChartFrame';
import type {BarViewport} from './ui/useBarViewport';

const HEIGHT=206;
const pagerNoun={daily:'days',weekly:'weeks',monthly:'months'} as const;
const TOP=12;
const BASE=164;
const LABEL_Y=182;

type ChartProps={rows:readonly ProgressEnergyBucket[];grouping:BucketGrouping;energyUnit:EnergyUnit;viewport:BarViewport;selected:number;plotProps:React.SVGProps<SVGSVGElement>};

function barWidth(slot:number){
  return Math.max(6,Math.min(28,slot*.56));
}

/** Day/week/month labels under each bar, and the selected slot's backdrop. */
function SlotDecor({rows,grouping,slot,selected}:{rows:readonly ProgressEnergyBucket[];grouping:BucketGrouping;slot:number;selected:number}){
  return <>
    {selected>=0&&<rect className="bar-slot-selected" x={selected*slot+1} y={TOP-6} width={Math.max(0,slot-2)} height={BASE-TOP+10} rx={6}/>}
    {rows.map((row,index)=>{
      const [top,bottom]=bucketAxisLabel(row.date,grouping);
      const center=slot*(index+.5);
      return <text key={row.date} className={index===selected?'bar-axis-label is-selected':'bar-axis-label'} x={center} y={LABEL_Y} textAnchor="middle">
        <tspan x={center}>{top}</tspan>
        {bottom&&<tspan x={center} dy="14">{bottom}</tspan>}
      </text>;
    })}
  </>;
}

/** Logged intake as bars against estimated maintenance as one stepped line. */
export function IntakeChart({rows,grouping,energyUnit,viewport,selected,plotProps}:ChartProps){
  const unit=energyLabel(energyUnit);
  const peak=Math.max(0,...rows.flatMap(row=>[row.intake??0,row.maintenance??0]));
  const ticks=niceTicks(0,Math.max(peak,500),4);
  const ceiling=ticks.at(-1)!;
  const y=(value:number)=>BASE-value/ceiling*(BASE-TOP);
  const {slot,contentWidth}=viewport;
  const bar=barWidth(slot);
  const axis=ticks.map(value=><text key={value} x={BAR_AXIS_WIDTH-8} y={y(value)+4} textAnchor="end">{displayEnergy(value,energyUnit)}</text>);
  return <BarChartFrame viewport={viewport} height={HEIGHT} axis={axis} plotProps={plotProps} pager={pagerNoun[grouping]}
    label={`Energy intake bars with the estimated maintenance line, grouped ${grouping}. ${rows.filter(row=>row.intake!=null).length} of ${rows.length} groups have logged intake.`}>
    {ticks.map(value=><line key={value} className={value===0?'chart-baseline':'chart-grid'} x1={0} x2={contentWidth} y1={y(value)} y2={y(value)}/>)}
    <SlotDecor rows={rows} grouping={grouping} slot={slot} selected={selected}/>
    {rows.map((row,index)=>{
      const x=slot*(index+.5)-bar/2;
      if(row.intake==null)return <rect key={row.date} className="bar-missing" x={x} y={BASE-3} width={bar} height={3} rx={1.5}/>;
      const top=y(row.intake);
      return <rect key={row.date} className={row.complete?'energy-intake':'energy-intake partial-bar'} x={x} y={top} width={bar} height={Math.max(2,BASE-top)} rx={Math.min(4,bar/3)}>
        <title>{row.date}: {displayEnergy(row.intake,energyUnit)} {unit} logged{row.complete?'':', not fully logged'}</title>
      </rect>;
    })}
    <path className="maintenance-line" d={steppedPath(rows.map(row=>row.maintenance),slot,y)}/>
  </BarChartFrame>;
}

/** Intake minus maintenance, diverging from a zero line. */
export function BalanceChart({rows,grouping,energyUnit,viewport,selected,plotProps}:ChartProps){
  const unit=energyLabel(energyUnit);
  const extent=Math.max(250,...rows.map(row=>Math.abs(row.balance??0)));
  const step=niceStep(extent,2);
  const limit=Math.ceil(extent/step)*step;
  const middle=(TOP+BASE)/2;
  const y=(value:number)=>middle-value/limit*(middle-TOP);
  const {slot,contentWidth}=viewport;
  const bar=barWidth(slot);
  const ticks=[limit,limit/2,0,-limit/2,-limit];
  const signed=(value:number)=>value===0?'0':`${value>0?'+':'−'}${displayEnergy(Math.abs(value),energyUnit)}`;
  const axis=ticks.map(value=><text key={value} x={BAR_AXIS_WIDTH-8} y={y(value)+4} textAnchor="end">{signed(value)}</text>);
  return <BarChartFrame viewport={viewport} height={HEIGHT} axis={axis} plotProps={plotProps} pager={pagerNoun[grouping]}
    label={`Surplus or deficit by ${grouping==='daily'?'day':grouping==='weekly'?'week':'month'}. Bars above zero are a surplus, below zero a deficit. Groups that are not fully logged or have no maintenance estimate have no bar.`}>
    {ticks.map(value=><line key={value} className={value===0?'chart-baseline':'chart-grid'} x1={0} x2={contentWidth} y1={y(value)} y2={y(value)}/>)}
    <SlotDecor rows={rows} grouping={grouping} slot={slot} selected={selected}/>
    {rows.map((row,index)=>{
      const x=slot*(index+.5)-bar/2;
      if(row.balance==null)return <rect key={row.date} className="bar-missing" x={x} y={middle-1.5} width={bar} height={3} rx={1.5}/>;
      const end=y(row.balance);
      return <rect key={row.date} className={row.balance>=0?'energy-surplus':'energy-deficit'} x={x} y={Math.min(middle,end)} width={bar} height={Math.max(2,Math.abs(end-middle))} rx={Math.min(4,bar/3)}>
        <title>{row.date}: {row.balance>=0?'surplus':'deficit'} of {displayEnergy(Math.abs(row.balance),energyUnit)} {unit}</title>
      </rect>;
    })}
  </BarChartFrame>;
}

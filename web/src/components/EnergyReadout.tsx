import type {EnergyUnit,ProgressEnergyBucket} from '../types';
import {displayEnergy,energyLabel} from '../lib/units';
import type {BucketGrouping} from '../lib/chartLabels';
import {bucketReadoutLabel} from '../lib/chartLabels';

export type EnergyView='intake'|'balance';

const singular={daily:'day',weekly:'week',monthly:'month'} as const;

function status(row:ProgressEnergyBucket){
  if(row.intake==null)return {tone:'none',text:'Not logged'};
  return row.complete?{tone:'complete',text:'Fully logged'}:{tone:'partial',text:'Partly logged'};
}

/** Why a balance cannot be drawn, in plain words; unknown stays unknown instead of becoming zero. */
function balanceNote(row:ProgressEnergyBucket,grouping:BucketGrouping){
  if(row.balance==null)return row.intake==null?'Nothing logged':!row.complete?`${singular[grouping][0].toUpperCase()}${singular[grouping].slice(1)} not fully logged`:'No maintenance estimate';
  return row.balance>0?'Surplus':row.balance<0?'Deficit':'Even';
}

/**
 * The selected day, week, or month in fixed cells, so a new selection never moves the chart.
 * The cells the visible chart draws are emphasised.
 */
export function EnergyReadout({id,row,grouping,energyUnit,view}:{id:string;row?:ProgressEnergyBucket;grouping:BucketGrouping;energyUnit:EnergyUnit;view:EnergyView}){
  const unit=energyLabel(energyUnit);
  const state=row?status(row):undefined;
  const figure=(value:number|null|undefined,signed=false)=>value==null?<span className="figure is-unknown">—</span>
    :<><span className="figure">{signed&&value!==0?(value>0?'+':'−'):''}{displayEnergy(signed?Math.abs(value):value,energyUnit)}</span> <span className="unit">{unit}</span></>;
  const tone=row?.balance==null?'':row.balance>0?'is-surplus':row.balance<0?'is-deficit':'';
  return <div id={id} className="chart-readout energy-readout" aria-live="polite">
    <div className="energy-readout-head">
      <strong className="chart-readout-date">{row?bucketReadoutLabel(row.date,row.end,grouping):'—'}</strong>
      {state&&<span className={`energy-readout-status is-${state.tone}`}>{state.text}</span>}
    </div>
    <dl className="energy-readout-cells">
      <div className={view==='intake'?'is-active':''}>
        <dt><span className="legend-swatch swatch-intake" aria-hidden="true"/>Intake</dt>
        <dd>{figure(row?.intake)}</dd>
        <small>{row?.intake==null?'Not logged':row.complete?'Logged total':'Logged so far'}</small>
      </div>
      <div className={view==='intake'?'is-active':''}>
        <dt><span className="legend-line swatch-maintenance" aria-hidden="true"/>Maintenance</dt>
        <dd>{figure(row?.maintenance)}</dd>
        <small>{row?.maintenance==null?'No estimate':'Keeps weight steady'}</small>
      </div>
      <div className={`${view==='balance'?'is-active ':''}${tone}`.trim()}>
        <dt><span className={`legend-swatch ${row?.balance!=null&&row.balance<0?'swatch-deficit':row?.balance!=null&&row.balance>0?'swatch-surplus':'swatch-missing'}`} aria-hidden="true"/>Balance</dt>
        <dd>{figure(row?.balance,true)}</dd>
        <small>{row?balanceNote(row,grouping):'—'}</small>
      </div>
    </dl>
  </div>;
}

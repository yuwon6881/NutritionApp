import type {ReactNode} from 'react';
import type {EnergyUnit,ProgressEnergyStatistics} from '../types';
import {displayEnergy,energyLabel} from '../lib/units';

function Stat({label,value,note,tone}:{label:string;value:ReactNode;note:string;tone?:string}){
  return <div className={tone}>
    <dt>{label}</dt>
    <dd>{value}</dd>
    <small>{note}</small>
  </div>;
}

/** Period totals for the Energy tab: tiles side by side, a label-and-value list on phones. */
export function EnergyStats({stats,energyUnit}:{stats?:ProgressEnergyStatistics;energyUnit:EnergyUnit}){
  const unit=<span className="unit">{energyLabel(energyUnit)}</span>;
  const balance=stats?.totalBalance;
  const tone=balance==null||balance===0?undefined:balance>0?'is-surplus':'is-deficit';
  const days=stats?.days??0;
  return <dl className="energy-stats">
    <Stat label="Complete days" value={<>{stats?.completeDays??0} <span className="unit">of {days}</span></>} note="Fully logged"/>
    <Stat label="Average intake" value={<>{displayEnergy(stats?.averageIntake,energyUnit)} {unit}</>} note={`${stats?.loggedDays??0} ${stats?.loggedDays===1?'day':'days'} logged`}/>
    <Stat label="Total balance" tone={tone} value={<>{balance==null?'—':`${balance>0?'+':balance<0?'−':''}${displayEnergy(Math.abs(balance),energyUnit)}`} {unit}</>} note={`${stats?.surplusDays??0} surplus · ${stats?.deficitDays??0} deficit`}/>
  </dl>;
}

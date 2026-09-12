import type {ProgressPeriod} from '../types';
import {shiftDate} from './energyBalance';

export const progressPeriodOptions:readonly {value:ProgressPeriod;label:string}[]=[
  {value:'week',label:'Last week'},
  {value:'month',label:'Last month'},
  {value:'six-months',label:'Last 6 months'},
  {value:'year',label:'One year'},
  {value:'all',label:'All'},
];

function calendarShift(date:string,months:number){
  const source=new Date(`${date}T00:00:00Z`);
  const day=source.getUTCDate();
  const shifted=new Date(Date.UTC(source.getUTCFullYear(),source.getUTCMonth()+months,1));
  const last=new Date(Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth()+1,0)).getUTCDate();
  shifted.setUTCDate(Math.min(day,last));
  return shifted.toISOString().slice(0,10);
}

export function progressRange(period:ProgressPeriod,today:string,earliest?:string){
  const start=period==='week'?shiftDate(today,-6)
    :period==='month'?shiftDate(calendarShift(today,-1),1)
    :period==='six-months'?shiftDate(calendarShift(today,-6),1)
    :period==='year'?shiftDate(calendarShift(today,-12),1)
    :earliest??today;
  return {start:start<'2000-01-01'?'2000-01-01':start,end:today};
}

export function progressPeriodLabel(period:ProgressPeriod){
  return progressPeriodOptions.find(option=>option.value===period)?.label??'Last month';
}

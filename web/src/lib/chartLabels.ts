import {monthYear,readoutDate,shortDate,weekdayShort} from './format';

export type BucketGrouping='daily'|'weekly'|'monthly';

/** Two short lines under a bar: weekday and day, week start, or month and year. */
export function bucketAxisLabel(date:string,grouping:BucketGrouping):[string,string]{
  if(grouping==='daily')return [weekdayShort(date),String(Number(date.slice(8,10)))];
  if(grouping==='weekly')return [shortDate(date),''];
  const [month,year]=monthYear(date).split(' ');
  return [month,year];
}

/** A bucket's full dates for a readout: one day, a week span, or a month. */
export function bucketReadoutLabel(date:string,end:string,grouping:BucketGrouping){
  if(date===end)return readoutDate(date);
  if(grouping==='monthly')return monthYear(date);
  return dateSpan(date,end);
}

/** "Sep 21 – 27, 2026", "Sep 28 – Oct 4, 2026", or "Dec 29, 2025 – Jan 4, 2026". */
export function dateSpan(start:string,end:string){
  if(start===end)return readoutDate(start).replace(/^\w+, /,'');
  const startYear=start.slice(0,4),endYear=end.slice(0,4);
  if(startYear!==endYear)return `${shortDate(start)}, ${startYear} – ${shortDate(end)}, ${endYear}`;
  const endLabel=start.slice(0,7)===end.slice(0,7)?String(Number(end.slice(8,10))):shortDate(end);
  return `${shortDate(start)} – ${endLabel}, ${endYear}`;
}

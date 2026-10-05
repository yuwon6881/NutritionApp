import {useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {Button} from '../ui/Button';
import {longDate} from '../../lib/format';
import type {CalendarMonth} from '../../lib/loggingCalendar';

const WEEKDAYS=['M','T','W','T','F','S','S'];
const WEEKDAY_NAMES=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const monthTitle=new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric',timeZone:'UTC'});

interface HabitMonthCalendarProps {
  tone:'food'|'weight';
  /** Newest month first, as returned by `calendarMonths`. */
  months:CalendarMonth[];
  byDate:Map<string,string>;
  current:string;
  describe:(status:string)=>string;
}

/**
 * One month at a time, opening on the current month. Paging stays inside the
 * months this device holds records for, so there is never an empty page to reach.
 */
export function HabitMonthCalendar({tone,months,byDate,current,describe}:HabitMonthCalendarProps){
  const [index,setIndex]=useState(0);
  const month=months[Math.min(index,months.length-1)];
  if(!month)return null;
  const title=monthTitle.format(new Date(`${month.month}-01T00:00:00Z`));
  const older=index<months.length-1;
  const newer=index>0;
  const headingId=`habit-${tone}-month`;
  return <section className={`habit-months habit-${tone}`} aria-labelledby={headingId}>
    <div className="habit-month-nav">
      <Button variant="tertiary" size="icon" disabled={!older} onClick={()=>setIndex(index+1)} aria-label="Previous month">
        <ChevronLeft size={18} aria-hidden="true"/>
      </Button>
      <h3 id={headingId} aria-live="polite">{title}</h3>
      <Button variant="tertiary" size="icon" disabled={!newer} onClick={()=>setIndex(index-1)} aria-label="Next month">
        <ChevronRight size={18} aria-hidden="true"/>
      </Button>
    </div>
    <div className="habit-grid habit-grid-full" role="list" aria-label={title}>
      {WEEKDAYS.map((day,weekday)=><span key={`h${weekday}`} className="habit-weekday" aria-hidden="true" title={WEEKDAY_NAMES[weekday]}>{day}</span>)}
      {Array.from({length:month.leading},(_,lead)=><span key={`l${lead}`} aria-hidden="true"/>)}
      {month.dates.map(date=>{
        const status=byDate.get(date)??(date>current?'future':'unknown');
        return <span key={date} role="listitem" className="habit-cell habit-day" data-status={status} data-today={date===current||undefined}>
          <span aria-hidden="true">{Number(date.slice(8))}</span>
          <span className="sr-only">{longDate(date)}: {describe(status)}</span>
        </span>;
      })}
    </div>
  </section>;
}

import {useState} from 'react';
import {Maximize2} from 'lucide-react';
import {Button} from '../ui/Button';
import {Modal} from '../ui/Modal';
import {longDate,monthYear} from '../../lib/format';
import {calendarMonths,type CalendarCell,type CalendarSummary} from '../../lib/loggingCalendar';
import './habits.css';

export interface HabitLegendItem {
  status:string;
  label:string;
}

export interface HabitCalendarCardProps {
  /** Short habit name, e.g. "Food logging". */
  title:string;
  /** Visual family for logged days: food uses the primary tone, weight its own. */
  tone:'food'|'weight';
  /** Recent weeks shown on the Dashboard card, oldest first. */
  recent:CalendarCell<string>[];
  /** Every day held on this device, oldest first, for the full calendar. */
  history:CalendarCell<string>[];
  summary:CalendarSummary;
  current:string;
  legend:HabitLegendItem[];
  /** Plain-language name for a day's status, read with its date. */
  describe:(status:string)=>string;
}

const WEEKDAYS=['M','T','W','T','F','S','S'];
const WEEKDAY_NAMES=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

function summaryText(summary:CalendarSummary){
  if(summary.known===0)return 'Nothing logged yet';
  return `${summary.logged} of ${summary.known} days`;
}

function streakText(streak:number){
  return streak>0?`${streak}-day streak`:'No current streak';
}

/**
 * A small habit heatmap on the Dashboard. The whole card opens the full
 * calendar so the compact grid can stay purely visual at a glance.
 */
export function HabitCalendarCard({title,tone,recent,history,summary,current,legend,describe}:HabitCalendarCardProps){
  const [open,setOpen]=useState(false);
  const [trigger,setTrigger]=useState<HTMLElement|null>(null);
  const byDate=new Map(history.map(cell=>[cell.date,cell.status]));
  // Start at the first month with a record so a new account does not open on empty months.
  const firstTracked=history.find(cell=>cell.status!=='before'&&cell.status!=='unknown')?.date??current;
  const months=calendarMonths(firstTracked,current);
  return <article className={`panel habit-calendar habit-${tone}`}>
    <Button
      presentation="plain"
      className="habit-calendar-trigger"
      aria-label={`${title}: ${summaryText(summary)} logged, ${streakText(summary.streak)}. Open full calendar`}
      onClick={event=>{setTrigger(event.currentTarget);setOpen(true);}}
    >
      <span className="habit-calendar-heading">
        <span className="eyebrow">{title.toUpperCase()}</span>
        <Maximize2 size={14} aria-hidden="true" className="habit-calendar-expand"/>
      </span>
      <strong className="habit-calendar-count">{summaryText(summary)}</strong>
      <small className="habit-calendar-streak">{streakText(summary.streak)}</small>
      <span className="habit-grid habit-grid-compact" aria-hidden="true">
        {recent.map(cell=><span key={cell.date} className="habit-cell" data-status={cell.status} data-today={cell.date===current||undefined}/>)}
      </span>
    </Button>
    <Modal open={open} onClose={()=>setOpen(false)} restoreFocus={trigger} title={title} description={`${summaryText(summary)} logged · ${streakText(summary.streak)}. Days not stored on this device are shown as unknown.`} width="md">
      <ul className="habit-legend" aria-label="Legend">
        {legend.map(item=><li key={item.status}><span className="habit-cell" data-status={item.status} aria-hidden="true"/>{item.label}</li>)}
      </ul>
      <div className={`habit-months habit-${tone}`}>
        {months.map(month=><section key={month.month} className="habit-month" aria-labelledby={`habit-${tone}-${month.month}`}>
          <h3 id={`habit-${tone}-${month.month}`}>{monthYear(`${month.month}-01`)}</h3>
          <div className="habit-grid habit-grid-full" role="list">
            {WEEKDAYS.map((day,index)=><span key={`h${index}`} className="habit-weekday" aria-hidden="true" title={WEEKDAY_NAMES[index]}>{day}</span>)}
            {Array.from({length:month.leading},(_,index)=><span key={`l${index}`} aria-hidden="true"/>)}
            {month.dates.map(date=>{
              const status=byDate.get(date)??(date>current?'future':'unknown');
              return <span key={date} role="listitem" className="habit-cell habit-day" data-status={status} data-today={date===current||undefined}>
                <span aria-hidden="true">{Number(date.slice(8))}</span>
                <span className="sr-only">{longDate(date)}: {describe(status)}</span>
              </span>;
            })}
          </div>
        </section>)}
      </div>
    </Modal>
  </article>;
}

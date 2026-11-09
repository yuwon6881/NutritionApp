import {useState} from 'react';
import {Maximize2} from 'lucide-react';
import {Button} from '../ui/Button';
import {Modal} from '../ui/Modal';
import {calendarMonths,type CalendarCell,type CalendarSummary} from '../../lib/loggingCalendar';
import {HabitMonthCalendar} from './HabitMonthCalendar';
import './habits.css';

export interface HabitLegendItem {
  status:string;
  label:string;
}

export interface HabitCalendarCardProps {
  /** Short habit name, e.g. "Food Logging". */
  title:string;
  /** Visual family for logged days: food uses the primary tone, weight its own. */
  tone:'food'|'weight';
  /** The last thirty days shown on the Dashboard card, oldest first. */
  recent:CalendarCell<string>[];
  /** Every day held on this device, oldest first, for the full calendar. */
  history:CalendarCell<string>[];
  summary:CalendarSummary;
  current:string;
  legend:HabitLegendItem[];
  /** Plain-language name for a day's status, read with its date. */
  describe:(status:string)=>string;
}

function summaryText(summary:CalendarSummary){
  if(summary.known===0)return 'Nothing logged yet';
  return `${summary.logged} of ${summary.known} days`;
}

/**
 * A small habit heatmap of the last thirty days on the Dashboard, headed by its
 * title and a "Last 30 days" subtitle. The whole card opens the real month calendar,
 * so the compact grid can stay purely visual at a glance.
 */
export function HabitCalendarCard({title,tone,recent,history,summary,current,legend,describe}:HabitCalendarCardProps){
  const [open,setOpen]=useState(false);
  const [trigger,setTrigger]=useState<HTMLElement|null>(null);
  // Each opening starts again on the current month.
  const [opened,setOpened]=useState(0);
  const byDate=new Map(history.map(cell=>[cell.date,cell.status]));
  // Start at the first month with a record so a new account does not open on empty months.
  const firstTracked=history.find(cell=>cell.status!=='before'&&cell.status!=='unknown')?.date??current;
  const months=calendarMonths(firstTracked,current);
  return <article className={`panel habit-calendar habit-${tone}`}>
    <Button
      presentation="plain"
      className="habit-calendar-trigger"
      aria-label={`${title}: Last 30 days. Open full calendar`}
      onClick={event=>{setTrigger(event.currentTarget);setOpened(opened+1);setOpen(true);}}
    >
      <span className="habit-calendar-heading">
        <strong className="habit-calendar-title">{title}</strong>
        <Maximize2 size={14} aria-hidden="true" className="habit-calendar-expand"/>
      </span>
      <small className="habit-calendar-subtitle">Last 30 days</small>
      <span className="habit-grid habit-grid-compact" aria-hidden="true">
        {recent.map(cell=><span key={cell.date} className="habit-cell" data-status={cell.status} data-today={cell.date===current||undefined}/>)}
      </span>
    </Button>
    <Modal open={open} onClose={()=>setOpen(false)} restoreFocus={trigger} title={title} description={`${summaryText(summary)} logged. Days not stored on this device are shown as unknown.`} width="sm">
      <ul className="habit-legend" aria-label="Legend">
        {legend.map(item=><li key={item.status}><span className="habit-cell" data-status={item.status} aria-hidden="true"/>{item.label}</li>)}
      </ul>
      <HabitMonthCalendar key={opened} tone={tone} months={months} byDate={byDate} current={current} describe={describe}/>
    </Modal>
  </article>;
}

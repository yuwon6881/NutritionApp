import type {CSSProperties} from 'react';
import {CalendarCheck} from 'lucide-react';
import type {CheckInSchedule} from '../lib/checkIn';
import {Button} from './ui/Button';

const radius=43;

const countdown=(days:number)=>days===1?'1 day':`${days} days`;

export function CheckInButton({schedule,label,onClick,disabled=false}:{schedule:CheckInSchedule;label:string;onClick:(trigger:HTMLElement)=>void;disabled?:boolean}){
  const actionable=schedule.due&&!disabled;
  const progress=schedule.due?1:Math.min(1,Math.max(0,1-schedule.daysUntil/7));
  const accessibleName=schedule.due?label:`${label} available in ${countdown(schedule.daysUntil)}`;
  // Ring lengths use pathLength=100; the gap spans the whole ring so the draw-in starts empty.
  const ringStyle={'--check-in-progress':progress*100} as CSSProperties;
  return <div className={`check-in-orb ${actionable?'is-actionable':schedule.due?'is-blocked':'is-waiting'}`} data-check-in-state={schedule.due?'ready':'waiting'}>
    <svg className="check-in-orb-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="check-in-orb-track" cx="50" cy="50" r={radius}/>
      <circle className="check-in-orb-progress" cx="50" cy="50" r={radius} pathLength={100} strokeDasharray={`${progress*100} 100`} style={ringStyle}/>
    </svg>
    <Button
      className="check-in-orb-button"
      variant={actionable?'primary':'secondary'}
      size="md"
      disabled={!actionable}
      aria-label={accessibleName}
      onClick={event=>onClick(event.currentTarget)}
    >
      {schedule.due
        ?<CalendarCheck size={24} aria-hidden="true"/>
        :<span className="check-in-orb-count" aria-hidden="true"><strong>{schedule.daysUntil}</strong><small>{schedule.daysUntil===1?'day':'days'}</small></span>}
    </Button>
  </div>;
}

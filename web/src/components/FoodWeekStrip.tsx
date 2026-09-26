import {swipedDate,weekStripDays} from '../lib/weekStrip';
import {useHorizontalSwipe} from '../lib/useHorizontalSwipe';
import {Button} from './ui/Button';

/**
 * Thumb-reachable day switching for the Food Log: tap a day of the current
 * week, or swipe the strip sideways to move one day. The Previous/Next
 * buttons and the date picker remain the accessible alternatives.
 */
export function FoodWeekStrip({date,today,loggedDates,onChange}:{
  date:string;
  today:string;
  /** Dates this device knows have food logged; unknown dates show no marker. */
  loggedDates:ReadonlySet<string>;
  onChange:(date:string)=>void;
}){
  const swipe=useHorizontalSwipe(direction=>{
    const next=swipedDate(date,direction,today);
    if(next!==date)onChange(next);
  });
  return <div className="food-week-strip" role="group" aria-label="Choose a day this week" {...swipe}>
    {weekStripDays(date,today).map(day=><Button
      key={day.date}
      variant="tertiary"
      presentation="plain"
      className="food-week-day"
      disabled={day.future}
      aria-current={day.date===date?'date':undefined}
      aria-label={`${day.weekday} ${day.dayOfMonth}${day.date===today?', today':''}${loggedDates.has(day.date)?', food logged':''}`}
      onClick={()=>onChange(day.date)}
    >
      <span className="food-week-day-name" aria-hidden="true">{day.weekday}</span>
      <span className="food-week-day-number" aria-hidden="true">{day.dayOfMonth}</span>
      <span className={`food-week-day-marker${loggedDates.has(day.date)?' logged':''}`} aria-hidden="true"/>
    </Button>)}
  </div>;
}

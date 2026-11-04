import {useState} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import type {WeightContextCode} from '../types';
import {weightContextChoicesFor} from '../lib/weightContext';
import {Button} from './ui/Button';

export interface WeightContextPickerProps {
  direction:'up'|'down'|'either';
  /** The chosen context, or an empty string for none. */
  value:WeightContextCode|'';
  onChange:(value:WeightContextCode|'')=>void;
}

/**
 * Optional reason for an unusual weigh-in, as loose chips that wrap on any width (tap the chosen one again to clear
 * it). The likeliest causes show first; "More reasons" adds the rest in place and stays open while one of them is
 * chosen, so the choice is never hidden.
 */
export function WeightContextPicker({direction,value,onChange}:WeightContextPickerProps){
  const {quick,more}=weightContextChoicesFor(direction);
  const chosenIsMore=more.some(option=>option.value===value);
  const [expanded,setExpanded]=useState(false);
  const showMore=expanded||chosenIsMore;
  const shown=showMore?[...quick,...more]:quick;
  return <div className="weight-context-picker">
    <p id="weight-context-hint" className="weight-context-hint">Optional — one-off swings are smoothed out either way.</p>
    <div className="weight-context-chips" role="group" aria-label="Possible reason" aria-describedby="weight-context-hint">
      {shown.map(option=>{
        const chosen=option.value===value;
        return <Button key={option.value} type="button" variant="secondary" size="sm" className="weight-context-chip" aria-pressed={chosen}
          onClick={()=>onChange(chosen?'':option.value)}>
          {chosen&&<Check size={14} strokeWidth={2.5} aria-hidden="true"/>}{option.label}
        </Button>;
      })}
      {more.length>0&&!chosenIsMore&&<Button type="button" variant="tertiary" size="sm" className="weight-context-more" aria-expanded={showMore}
        onClick={()=>setExpanded(open=>!open)}>
        {showMore?'Fewer reasons':'More reasons'}<ChevronDown size={14} aria-hidden="true"/>
      </Button>}
    </div>
  </div>;
}

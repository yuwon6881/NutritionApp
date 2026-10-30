import {useState} from 'react';
import type {WeightContextCode} from '../types';
import {weightContextChoicesFor} from '../lib/weightContext';
import {Button} from './ui/Button';
import {SegmentedControl} from './ui/SegmentedControl';
import {Select} from './ui/Select';

export interface WeightContextPickerProps {
  direction:'up'|'down'|'either';
  /** The chosen context, or an empty string for none. */
  value:WeightContextCode|'';
  onChange:(value:WeightContextCode|'')=>void;
}

/**
 * Optional reason for an unusual weigh-in. The likeliest causes are one-tap chips (tap again to clear); the
 * rest sit behind "More reasons", which opens by itself when the chosen reason is not a chip.
 */
export function WeightContextPicker({direction,value,onChange}:WeightContextPickerProps){
  const {quick,more}=weightContextChoicesFor(direction);
  const chosenIsMore=more.some(option=>option.value===value);
  const [expanded,setExpanded]=useState(false);
  const showMore=more.length>0&&(expanded||chosenIsMore);
  return <div className="weight-context-picker">
    <SegmentedControl<WeightContextCode|''> id="weight-entry-context" className="weight-context-chips" label="Possible temporary context" size="sm" layout="wrap"
      value={chosenIsMore?'':value}
      options={quick}
      onChange={next=>onChange(next===value?'':next)}/>
    {more.length>0&&<>
      <Button type="button" variant="tertiary" size="sm" className="weight-context-more" aria-expanded={showMore}
        disabled={chosenIsMore} onClick={()=>setExpanded(open=>!open)}>{showMore?'Fewer reasons':'More reasons'}</Button>
      {showMore&&<Select
        id="weight-entry-context-more"
        label="Another reason"
        value={chosenIsMore?value:''}
        placeholder="Choose another reason"
        options={[{value:'',label:'No reason'},...more]}
        onChange={next=>onChange(next as WeightContextCode|'')}
      />}
    </>}
  </div>;
}

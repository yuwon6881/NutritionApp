import {Check} from 'lucide-react';
import type {ActivityLevel,ProfileDraft} from '../types';
import {activityLevelInfo,activityLevels} from '../lib/activityLevels';
import {FieldFrame} from './ui/Form';

/** The coach's activity step: four choices that set the activity multiplier and lifting protein. */
export function ActivitySelection({profile,onChange}:{profile:ProfileDraft;onChange:(level:ActivityLevel)=>void}){
  const selected=profile.activityLevel??null;
  return <FieldFrame label="Your activity"><fieldset className="coach-goals"><legend>Your activity</legend>
    <div className="coach-goal-options coach-activity-options">
      {activityLevels.map(level=>{
        const info=activityLevelInfo(level);
        return <label key={level} htmlFor={`coach-activity-${level}`} className={`coach-goal-option coach-activity-option ${selected===level?'selected':''}`}>
          <input id={`coach-activity-${level}`} required={!(profile.activity>0)} type="radio" name="coach-activity" value={level}
            checked={selected===level} onChange={()=>onChange(level)}/>
          <span className="coach-activity-label">{info.label}</span>
          <Check size={16} aria-hidden="true"/>
        </label>;
      })}
    </div>
  </fieldset></FieldFrame>;
}

import {Check} from 'lucide-react';
import type {ActivityLevel,ProfileDraft} from '../types';
import {activityLevelInfo,activityLevels,closestActivityLevel} from '../lib/activityLevels';
import {FieldFrame} from './ui/Form';

/** The coach's activity step: four choices that set the activity multiplier and lifting protein. */
export function ActivitySelection({profile,onChange}:{profile:ProfileDraft;onChange:(level:ActivityLevel)=>void}){
  const selected=profile.activityLevel??null;
  // A profile saved before these choices keeps its own multiplier until one is chosen.
  const closest=selected?null:closestActivityLevel(profile);
  return <FieldFrame label="Your activity"><fieldset className="coach-goals"><legend>Your activity</legend>
    <div className="coach-goal-options coach-activity-options">
      {activityLevels.map(level=>{
        const info=activityLevelInfo(level);
        return <label key={level} htmlFor={`coach-activity-${level}`} className={`coach-goal-option coach-activity-option ${selected===level?'selected':''}`}>
          <input id={`coach-activity-${level}`} required={!(profile.activity>0)} type="radio" name="coach-activity" value={level}
            checked={selected===level} onChange={()=>onChange(level)} aria-describedby={`coach-activity-${level}-note`}/>
          <span className="coach-activity-text"><strong>{info.label}</strong><small id={`coach-activity-${level}-note`}>{info.description}</small></span>
          <Check size={16} aria-hidden="true"/>
        </label>;
      })}
    </div>
    {closest&&<p className="muted">Your saved activity multiplier is {profile.activity}. The closest choice is {activityLevelInfo(closest).label}.</p>}
  </fieldset></FieldFrame>;
}

import {Flag} from 'lucide-react';
import {Button} from './ui/Button';

/** The Dashboard ring's replacement once a goal is reached; it mirrors the check-in ring. */
export function GoalReachedOrb({onClick}:{onClick:(trigger:HTMLElement)=>void}){
  return <div className="check-in-orb is-actionable" data-goal-state="reached">
    <svg className="check-in-orb-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="check-in-orb-track" cx="50" cy="50" r={43}/>
      <circle className="check-in-orb-progress" cx="50" cy="50" r={43} pathLength={100} strokeDasharray="100 100"/>
    </svg>
    <Button className="check-in-orb-button" variant="primary" size="md" aria-label="Goal complete" onClick={event=>onClick(event.currentTarget)}>
      <Flag size={24} aria-hidden="true"/>
    </Button>
  </div>;
}

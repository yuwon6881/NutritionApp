import {useMemo} from 'react';
import {Sliders} from 'lucide-react';
import type {AppState,CoachResult,UnitPreferences} from '../../types';
import {liveGoalProgress,mergeGoalProgress} from '../../lib/goalProgress';
import {planHeadline} from '../../lib/coachTargetSummary';
import {Button} from '../ui/Button';
import {GoalSummary} from '../GoalSummary';

/** The plan's headline and goal progress, with Edit plan beside the thing it edits. */
export function CoachGoalCard({state,units,acceptedPlan,current,disabled,onEdit}:{
  state:AppState;
  units:UnitPreferences;
  acceptedPlan?:CoachResult;
  current:string;
  disabled:boolean;
  onEdit:()=>void;
}){
  const phaseDecision=state.phaseDecisions?.find(decision=>decision.profileRevision===state.profileRevision&&!decision.deleted);
  const metric=state.settings?.weightGoalMetric??'scale';
  const live=useMemo(
    ()=>liveGoalProgress(state.profile,[...(state.weightTrendSeed??[]),...state.weights.filter(weight=>!weight.deleted)],current,phaseDecision,metric),
    [state.profile,state.weightTrendSeed,state.weights,current,phaseDecision,metric]
  );
  const progress=mergeGoalProgress(acceptedPlan?.goalProgress,live,phaseDecision);
  return <section className="panel coach-goal-card" aria-labelledby="coach-plan-title">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Your plan</p>
        <h2 id="coach-plan-title">{planHeadline(progress,state.profile?.goal??'',units)}</h2>
      </div>
      <div className="actions">
        <Button variant="secondary" size="md" disabled={disabled} onClick={onEdit}><Sliders size={16}/>Edit plan</Button>
      </div>
    </div>
    {progress&&<GoalSummary progress={progress} units={units} weightGoalMetric={metric} titleId="coach-goal-progress-title"/>}
  </section>;
}

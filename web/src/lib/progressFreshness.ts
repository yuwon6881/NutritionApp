import type {AppState} from '../types';

export function progressDataKey(state?:AppState):string {
  if(!state)return '';
  // Older snapshots do not have domain revisions; their account revision remains a safe fallback.
  if(state.diaryRevision==null||state.trajectoryRevision==null)return String(state.revision);
  const planRevision=state.plans.reduce((revision,plan)=>Math.max(revision,plan.revision),0);
  return [state.profileRevision,state.diaryRevision,state.trajectoryRevision,planRevision].join(':');
}

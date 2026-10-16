import type {NutritionStore} from '../useNutritionStore';
import type {GoogleHealthSyncState} from '../lib/googleHealth';
import {GoogleHealthStepsCard} from './GoogleHealthStepsCard';
import {StepCalorieCalculator} from './StepCalorieCalculator';

/** The steps dialog body, loaded when the chip is first opened so the Dashboard's first load stays small. */
export default function DashboardStepsDetails({store,health,todayDate,onOpenSettings}:{
  store:NutritionStore;
  health:Pick<GoogleHealthSyncState,'status'|'freshness'|'lastSyncedAt'|'days'|'warningMessage'>;
  todayDate:string;
  onOpenSettings?:()=>void;
}){
  return <GoogleHealthStepsCard status={health.status} freshness={health.freshness} lastSyncedAt={health.lastSyncedAt} days={health.days}
    todayDate={todayDate} warningMessage={health.warningMessage} onOpenSettings={onOpenSettings}>
    <StepCalorieCalculator store={store} variant="inline"/>
  </GoogleHealthStepsCard>;
}

import {useEffect} from 'react';
import type {NutritionStore} from '../../useNutritionStore';
import {today} from '../../lib/format';
import {useGoogleHealth} from '../../lib/googleHealth';
import {Button} from '../ui/Button';
import {SwipeCarousel,type CarouselSlide} from '../ui/SwipeCarousel';
import {GoogleHealthProgressChart} from '../GoogleHealthProgressChart';
import {StepCalorieCalculator} from '../StepCalorieCalculator';
import {TrainingSummaryCard} from '../TrainingSummaryCard';

/**
 * Activity that did not come from the food diary: daily steps from Google Health, what they are
 * worth in calories, and workouts from the Workout app. Without either connection the card
 * says how to connect one.
 */
export function ActivityCard({store,onSettings}:{store:NutritionStore;onSettings?:()=>void}){
  const {state:health,loading:healthLoading}=useGoogleHealth();
  const state=store.state!;
  const loadTrainingSummaries=store.loadTrainingSummaries;
  useEffect(()=>{if(state.workoutConnected!==false)void loadTrainingSummaries?.();},[loadTrainingSummaries,state.workoutConnected]);
  const healthConnected=health.status!=='disconnected';
  const workoutConnected=Boolean(state.workoutConnected||(state.trainingSummaries&&state.trainingSummaries.length>0));
  const workoutSettled=Boolean(store.trainingResolved||state.trainingSyncedAt||(state.trainingSummaries&&state.trainingSummaries.length>0));
  const loading=healthLoading||(!workoutSettled&&state.workoutConnected!==false);
  const slides:CarouselSlide[]=[
    {id:'steps',ariaLabel:'Daily steps',content:(
      <GoogleHealthProgressChart days={health.days??[]} status={health.status} freshness={health.freshness} todayDate={today(state.profile?.timeZone)} loading={healthLoading} onOpenSettings={onSettings}>
        <StepCalorieCalculator store={store} variant="panel"/>
      </GoogleHealthProgressChart>
    )},
    {id:'workouts',ariaLabel:'Workouts',content:<TrainingSummaryCard syncedAt={state.trainingSyncedAt} summaries={state.trainingSummaries} settings={state.settings} timeZone={state.profile?.timeZone} workoutConnected={state.workoutConnected} warning={state.workoutWarning} loading={store.trainingLoading} resolved={store.trainingResolved} error={store.trainingError} onOpenSettings={onSettings} onRetry={()=>void loadTrainingSummaries?.(true)}/>},
  ];
  return <section className="panel dashboard-wide-card activity-card" aria-labelledby="dashboard-activity-title">
    <div className="dashboard-card-head"><h3 id="dashboard-activity-title" className="dashboard-card-title">Activity</h3></div>
    {healthConnected||workoutConnected||loading
      ?<SwipeCarousel label="Activity view" slides={slides}/>
      :<div className="activity-connect">
        <p className="chart-description">Steps come from Google Health and workouts from Workout. Neither changes your targets.</p>
        {onSettings&&<Button variant="primary" size="md" onClick={onSettings}>Open connected apps</Button>}
      </div>}
  </section>;
}

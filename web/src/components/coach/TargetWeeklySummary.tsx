import {useState} from 'react';
import type {CoachResult,UnitPreferences} from '../../types';
import {displayEnergy,energyLabel} from '../../lib/units';
import {getWeeklyScheduleSubtitle} from './WeeklyScheduleReview';
import {allDaysEqual} from '../../lib/coachPlanHelpers';
import {Button} from '../ui/Button';

const DAY_NAMES=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export function TargetWeeklySummary({result,units}:{result:CoachResult;units:UnitPreferences}){
  const [showEachDay,setShowEachDay]=useState(false);
  const daily=result.dailyCalories;
  if(daily?.length!==7)return null;

  const equal=allDaysEqual(daily);
  const avg=Math.round((result.weeklyCalories??daily.reduce((t,c)=>t+c,0))/7);

  const chips=(
    <div className="target-weekly-chips">
      {daily.map((calories,index)=>{
        const dayName=DAY_NAMES[index]??`Day ${index+1}`;
        const diff=calories-avg;
        const isBoosted=diff>0;
        return (
          <div
            key={index}
            className={`weekly-day-chip ${isBoosted?'is-boosted':''}`}
            aria-label={`${dayName}: ${displayEnergy(calories,units.energy)} ${energyLabel(units.energy)}`}
          >
            <span className="weekly-day-name" aria-hidden="true">{dayName}</span>
            <strong className="weekly-day-val" aria-hidden="true">{displayEnergy(calories,units.energy)}</strong>
            {isBoosted&&(
              <span className="weekly-chip-badge" aria-label={`+${displayEnergy(diff,units.energy)} ${energyLabel(units.energy)}`}>
                +{displayEnergy(diff,units.energy)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="target-weekly-summary">
      <div className="target-weekly-header">
        <div>
          <p>Weekly budget</p>
          <strong>{displayEnergy(result.weeklyCalories,units.energy)} <span className="unit">{energyLabel(units.energy)}</span></strong>
        </div>
        {!equal&&<span className="target-weekly-badge">{getWeeklyScheduleSubtitle(daily)}</span>}
        {equal&&(
          <Button
            variant="tertiary"
            size="sm"
            aria-expanded={showEachDay}
            onClick={()=>setShowEachDay(v=>!v)}
          >
            {showEachDay?'Hide each day':'Show each day'}
          </Button>
        )}
      </div>
      {equal?(
        <>
          <p className="target-weekly-equal-val">
            {displayEnergy(daily[0],units.energy)} {energyLabel(units.energy)} every day
          </p>
          {showEachDay&&chips}
        </>
      ):(
        chips
      )}
    </div>
  );
}

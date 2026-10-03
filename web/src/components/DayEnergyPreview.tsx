import {useEffect,useState} from 'react';
import type {NutritionStore} from '../useNutritionStore';
import {sharedDiaryCoordinator} from '../lib/diaryCoordinator';
import {projectedDayCalories} from '../lib/dayIntake';
import {calendarTarget} from '../lib/calendarProgress';
import {dayEnergyPreview} from '../lib/dayEnergyPreview';
import {today} from '../lib/format';
import {displayEnergy,energyLabel,unitsFor} from '../lib/units';
import {EnergyRing} from './EnergyRing';

/** How the batch review's day would stand once its foods are logged. */
export function DayEnergyPreview({store,date,batchCalories}:{store:NutritionStore;date:string;batchCalories:number}){
  const state=store.state!;
  const energyUnit=unitsFor(state.settings).energy;
  const unit=energyLabel(energyUnit);
  // The dated cache can finish loading after the review opens; re-read it when it does.
  const [,refresh]=useState(0);
  useEffect(()=>sharedDiaryCoordinator.subscribe(updated=>{if(!updated||updated===date)refresh(value=>value+1);}),[date]);
  const preview=dayEnergyPreview(projectedDayCalories(store.local,date),batchCalories,calendarTarget(state,date));
  const heading=date===today(state.profile?.timeZone)?'TODAY AFTER LOGGING':'THIS DAY AFTER LOGGING';
  const energy=(value:number)=>`${displayEnergy(value,energyUnit)} ${unit}`;
  return <section className="day-energy-preview" aria-label="Day total after logging">
    <div className="day-energy-preview-figures">
      <p className="eyebrow">{heading}</p>
      {preview.logged==null
        ?<p className="day-energy-preview-note">Earlier entries for this day aren't on this device, so the day total is unknown.</p>
        :<dl>
          <div><dt><span className="day-energy-swatch logged" aria-hidden="true"/>Already logged</dt><dd>{energy(preview.logged)}</dd></div>
          <div><dt><span className="day-energy-swatch batch" aria-hidden="true"/>This batch</dt><dd>+{energy(preview.batch)}</dd></div>
          <div><dt>Target</dt><dd>{preview.target==null?'No target set':energy(preview.target)}</dd></div>
        </dl>}
    </div>
    {preview.logged!=null&&preview.target!=null&&<EnergyRing total={preview.logged} pending={preview.batch} target={preview.target} energyUnit={energyUnit} intro={false}/>}
  </section>;
}

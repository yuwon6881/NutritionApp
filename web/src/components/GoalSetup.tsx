import type {CSSProperties} from 'react';
import type {ProfileDraft} from '../types';
import {today,number} from '../lib/format';
import {calculateLivePace} from '../lib/coachCalc';
import {Field,SelectField} from './ui/Field';
import {DatePicker} from './ui/DatePicker';
import {CoachLayout,CoachNumber} from './ui/CoachMotion';

export function GoalSetup({
  profile,
  set,
  acceptedExpenditure
}:{
  profile:ProfileDraft;
  set:(key:keyof ProfileDraft,value:unknown)=>void;
  acceptedExpenditure?:number|null;
}){
  const loss=profile.goal==='lose';
  const percent=profile.energyAdjustmentPercent??(loss?15:5);
  const mode=profile.phaseMode??'open';
  const current=today(profile.timeZone);
  const live=calculateLivePace(profile,percent,acceptedExpenditure,current);
  const paced=profile.goal&&profile.goal!=='maintain';

  return <CoachLayout className="goal-setup">
    <div className="live-calorie-card">
      <div className="live-calorie-header">
        <span className="live-calorie-tag">ESTIMATED TARGET</span>
        <div className="live-calorie-value">
          <strong><CoachNumber>{number(live.target)}</CoachNumber></strong> <span className="unit">kcal / day</span>
        </div>
      </div>
      <div className="live-calorie-meta">
        <span>Maintenance ~{number(live.expenditure)} kcal</span>
        {paced&&<span className="live-delta">{loss?'−':'+'}{Math.abs(live.change)} kcal · {percent}%</span>}
      </div>
    </div>

    {paced&&<Field
      id="goal-energy-adjustment"
      name="energyAdjustmentPercent"
      label={loss?`Calorie deficit · ${percent}%`:`Calorie surplus · ${percent}%`}
      type="range"
      min="2"
      max={loss?25:20}
      step="1"
      value={percent}
      style={{'--range-fill':`${Math.round(100*(percent-2)/((loss?25:20)-2))}%`} as CSSProperties}
      aria-label={loss?'Calorie deficit (%)':'Calorie surplus (%)'}
      aria-valuetext={`${percent}% ${loss?'deficit':'surplus'}`}
      onChange={e=>set('energyAdjustmentPercent',Number(e.target.value))}
    />}

    <SelectField id="goal-phase-mode" name="phaseMode" label="Track my goal by" value={mode} onChange={v=>{
      set('phaseMode',v);
      if(v==='duration'&&!profile.durationWeeks)set('durationWeeks',8);
      set('phaseStart',current);
      set('phaseStartWeightKg',profile.weightKg>0?profile.weightKg:null);
    }}>
      <option value="open">Ongoing phase</option>
      <option value="duration">Duration</option>
      <option value="weight" disabled={!profile.goal||profile.goal==='maintain'}>Target weight</option>
    </SelectField>

    {mode==='duration'&&<div className="form-grid coach-disclosure">
      <Field id="goal-duration-weeks" name="durationWeeks" label="Phase length (weeks)" required type="number" min="1" max="104" value={profile.durationWeeks??8} onChange={e=>set('durationWeeks',Number(e.target.value))}/>
      <DatePicker id="goal-phase-start" name="phaseStart" label="Phase start date" min="2000-01-01" required max={current} value={profile.phaseStart??current} onChange={v=>set('phaseStart',v)}/>
    </div>}

    {mode==='weight'&&<div className="form-grid coach-disclosure">
      <Field id="goal-phase-start-weight" name="phaseStartWeightKg" label="Phase starting weight (kg)" required type="number" min="20" max="400" step="0.1" value={(profile.phaseStartWeightKg??profile.weightKg)||''} onChange={e=>set('phaseStartWeightKg',Number(e.target.value))}/>
      <Field id="goal-target-weight" name="targetWeightKg" validate={()=>{const target=profile.targetWeightKg;const initial=profile.phaseStartWeightKg??profile.weightKg;if(target==null)return undefined;if(profile.goal==='lose'&&target>=initial)return 'Choose a target below your phase starting weight.';if(profile.goal==='gain'&&target<=initial)return 'Choose a target above your phase starting weight.';if(profile.goal==='lose'&&target/Math.pow(profile.heightCm/100,2)<18.5)return 'Choose a target with a BMI of at least 18.5.';return undefined;}} label="Target weight (kg)" required type="number" min="20" max="400" step="0.1" value={profile.targetWeightKg??''} onChange={e=>set('targetWeightKg',e.target.value?Number(e.target.value):null)}/>
    </div>}
  </CoachLayout>;
}

import type {ProfileDraft,UnitPreferences} from '../types';
import {today} from '../lib/format';
import {calculateLivePace,profileAge} from '../lib/coachCalc';
import {Field,SelectField} from './ui/Field';
import {Slider} from './ui/Slider';
import {DatePicker} from './ui/DatePicker';
import {CoachLayout,CoachNumber} from './ui/CoachMotion';
import {displayEnergy,energyLabel,inputWeight,parseWeight,weightLabel} from '../lib/units';

export function GoalSetup({
  profile,
  set,
  acceptedExpenditure,
  units
}:{
  profile:ProfileDraft;
  set:(key:keyof ProfileDraft,value:unknown)=>void;
  acceptedExpenditure?:number|null;
  units:UnitPreferences;
}){
  const loss=profile.goal==='lose';
  const paced=profile.goal&&profile.goal!=='maintain';
  const rate=profile.goalRatePercent??(loss?-0.5:profile.goal==='gain'?0.15:0);
  const mode=profile.phaseMode??(profile.goal==='maintain'?'open':'weight');
  const current=today(profile.timeZone);
  const live=calculateLivePace(profile,undefined,acceptedExpenditure,current);
  const bmi=profile.heightCm>0?profile.weightKg/Math.pow(profile.heightCm/100,2):null;
  const blockedReason=profileAge(profile,current)<18||profile.pregnancyOrBreastfeeding||profile.medicalNutrition
    ?'Automated targets are unavailable for this profile. You can still keep a food and weight diary.'
    :loss&&bmi!=null&&bmi<18.5?'Weight-loss coaching is unavailable at an underweight BMI.':null;

  return <CoachLayout className="goal-setup">
    {blockedReason?<div className="live-calorie-card">
      <p className="source">{blockedReason}</p>
    </div>:<div className="live-calorie-card">
      <div className="live-calorie-header">
        <span className="live-calorie-tag">ESTIMATED TARGET</span>
        <div className="live-calorie-value">
        <strong><CoachNumber>{displayEnergy(live.target,units.energy)}</CoachNumber></strong> <span className="unit">{energyLabel(units.energy)} / day</span>
        </div>
      </div>
      <div className="live-calorie-meta">
        <span>Maintenance ~{displayEnergy(live.expenditure,units.energy)} {energyLabel(units.energy)}</span>
        {paced&&<span className="live-delta">{live.change<0?'−':'+'}{displayEnergy(Math.abs(live.change),units.energy)} {energyLabel(units.energy)} · {Math.abs(rate)}% bodyweight/week</span>}
      </div>
    </div>}

    {paced&&<Slider
      id="goal-rate"
      name="goalRatePercent"
      label="Rate (% bodyweight per week)"
      min={loss?-1.5:0.05}
      max={loss?-0.1:0.5}
      step={0.05}
      value={rate}
      formatValue={v => `${v > 0 ? '+' : ''}${v.toFixed(2)}% / week`}
      ariaLabel="Rate (% bodyweight per week)"
      onChange={v=>set('goalRatePercent',v)}
      hint={loss?'Allowed: 0.1–1.5% loss per week. A sustainable range is 0.5–1.0%.':'Allowed: 0.05–0.5% gain per week. A sustainable range is 0.1–0.25%.'}
    />}
    {!paced&&<p className="source">Maintenance uses a fixed 0% bodyweight change rate.</p>}

    {paced?(
      <SelectField id="goal-phase-mode" name="phaseMode" label="Track my goal by" value={mode} onChange={v=>{
        set('phaseMode',v);
        if(v==='duration'&&!profile.durationWeeks)set('durationWeeks',8);
        set('phaseStart',current);
        set('phaseStartWeightKg',profile.weightKg>0?profile.weightKg:null);
      }}>
        <option value="weight">Target weight</option>
        <option value="duration">Duration</option>
      </SelectField>
    ):(
      <p className="source">Maintenance is tracked as an ongoing phase.</p>
    )}

    {mode==='duration'&&<div className="form-grid coach-disclosure">
      <Field id="goal-duration-weeks" name="durationWeeks" label="Phase length (weeks)" required type="number" min="1" max="104" value={profile.durationWeeks??8} onChange={e=>set('durationWeeks',Number(e.target.value))}/>
      <DatePicker id="goal-phase-start" name="phaseStart" label="Phase start date" min="2000-01-01" required max={current} value={profile.phaseStart??current} onChange={v=>set('phaseStart',v)}/>
    </div>}

    {mode==='weight'&&<div className="form-grid coach-disclosure">
      <Field id="goal-phase-start-weight" name="phaseStartWeightKg" label={`Phase starting weight (${weightLabel(units.weight)})`} required type="number" min={units.weight==='lb'?44.1:20} max={units.weight==='lb'?881.8:400} step="0.1" value={inputWeight(profile.phaseStartWeightKg??profile.weightKg,units.weight,1)} onChange={e=>{const next=parseWeight(e.target.value,units.weight);set('phaseStartWeightKg',Number.isFinite(next)?next:0);}}/>
      <Field id="goal-target-weight" name="targetWeightKg" validate={()=>{const target=profile.targetWeightKg;const initial=profile.phaseStartWeightKg??profile.weightKg;if(target==null)return undefined;if(profile.goal==='lose'&&target>=initial)return 'Choose a target below your phase starting weight.';if(profile.goal==='gain'&&target<=initial)return 'Choose a target above your phase starting weight.';if(profile.goal==='lose'&&target/Math.pow(profile.heightCm/100,2)<18.5)return 'Choose a target with a BMI of at least 18.5.';return undefined;}} label={`Target weight (${weightLabel(units.weight)})`} required type="number" min={units.weight==='lb'?44.1:20} max={units.weight==='lb'?881.8:400} step="0.1" value={profile.targetWeightKg==null?'':inputWeight(profile.targetWeightKg,units.weight,1)} onChange={e=>{const next=parseWeight(e.target.value,units.weight);set('targetWeightKg',e.target.value===''?null:Number.isFinite(next)?next:null);}}/>
    </div>}
  </CoachLayout>;
}

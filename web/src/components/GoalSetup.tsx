import {Check} from 'lucide-react';
import type {ProfileDraft,UnitPreferences} from '../types';
import {today} from '../lib/format';
import {calculateLivePace,getPaceStatus,profileAge} from '../lib/coachCalc';
import {Field,SelectField} from './ui/Field';
import {FieldFrame} from './ui/Form';
import {Slider} from './ui/Slider';
import {DatePicker} from './ui/DatePicker';
import {CoachLayout,CoachNumber} from './ui/CoachMotion';
import {displayEnergy,energyLabel,inputWeight,parseWeight,weightLabel} from '../lib/units';
import {goalLabel} from './Coach';

export function GoalPhaseSetup({
  profile,
  set,
  units
}:{
  profile:ProfileDraft;
  set:(key:keyof ProfileDraft,value:unknown)=>void;
  units:UnitPreferences;
}){
  const loss=profile.goal==='lose';
  const paced=profile.goal&&profile.goal!=='maintain';
  const mode=profile.phaseMode??(profile.goal==='maintain'?'open':'weight');
  const current=today(profile.timeZone);
  const bmi=profile.heightCm>0?profile.weightKg/Math.pow(profile.heightCm/100,2):null;
  const blockedReason=profileAge(profile,current)<18||profile.pregnancyOrBreastfeeding||profile.medicalNutrition
    ?'Automated targets are unavailable for this profile. You can still keep a food and weight diary.'
    :loss&&bmi!=null&&bmi<18.5?'Weight-loss coaching is unavailable at an underweight BMI.':null;

  return <div className="goal-phase-setup">
    <FieldFrame label="Your goal"><fieldset className="coach-goals"><legend>Your goal</legend><div className="coach-goal-options">
      {(['lose','maintain','gain'] as const).map(goal=><label key={goal} htmlFor={`coach-goal-${goal}`} className={`coach-goal-option ${profile.goal===goal?'selected':''}`}>
        <input id={`coach-goal-${goal}`} required type="radio" name="coach-goal" value={goal} checked={profile.goal===goal} onChange={()=>set('goal',goal)}/>
        <span>{goalLabel(goal)}</span><Check size={16} aria-hidden="true"/>
      </label>)}
    </div></fieldset></FieldFrame>

    {blockedReason?<div className="notice"><p className="source">{blockedReason}</p></div>:(
      <>
        <SelectField id="goal-phase-mode" name="phaseMode" label="Track my goal by" value={mode} onChange={v=>{
          set('phaseMode',v);
          if(v==='duration'&&!profile.durationWeeks)set('durationWeeks',8);
          set('phaseStart',current);
          set('phaseStartWeightKg',profile.weightKg>0?profile.weightKg:null);
        }}>
          {paced&&<option value="weight">Target weight</option>}
          <option value="duration">Duration</option>
          <option value="open">No end date</option>
        </SelectField>

        {mode==='duration'&&<div className="form-grid coach-disclosure">
          <Field id="goal-duration-weeks" name="durationWeeks" label="Phase length (weeks)" required type="number" min="1" max="104" value={profile.durationWeeks??8} onChange={e=>set('durationWeeks',Number(e.target.value))}/>
          <DatePicker id="goal-phase-start" name="phaseStart" label="Phase start date" min="2000-01-01" required max={current} value={profile.phaseStart??current} onChange={v=>set('phaseStart',v)}/>
        </div>}

        {mode==='weight'&&paced&&<div className="form-grid coach-disclosure">
          <Field id="goal-phase-start-weight" name="phaseStartWeightKg" label={`Phase starting weight (${weightLabel(units.weight)})`} required type="number" min={units.weight==='lb'?44.1:20} max={units.weight==='lb'?881.8:400} step="0.1" value={inputWeight(profile.phaseStartWeightKg??profile.weightKg,units.weight,1)} onChange={e=>{const next=parseWeight(e.target.value,units.weight);set('phaseStartWeightKg',Number.isFinite(next)?next:0);}}/>
          <Field id="goal-target-weight" name="targetWeightKg" validate={()=>{const target=profile.targetWeightKg;const initial=profile.phaseStartWeightKg??profile.weightKg;if(target==null)return undefined;if(profile.goal==='lose'&&target>=initial)return 'Choose a target below your phase starting weight.';if(profile.goal==='gain'&&target<=initial)return 'Choose a target above your phase starting weight.';if(profile.goal==='lose'&&target/Math.pow(profile.heightCm/100,2)<18.5)return 'Choose a target with a BMI of at least 18.5.';return undefined;}} label={`Target weight (${weightLabel(units.weight)})`} required type="number" min={units.weight==='lb'?44.1:20} max={units.weight==='lb'?881.8:400} step="0.1" value={profile.targetWeightKg==null?'':inputWeight(profile.targetWeightKg,units.weight,1)} onChange={e=>{const next=parseWeight(e.target.value,units.weight);set('targetWeightKg',e.target.value===''?null:Number.isFinite(next)?next:null);}}/>
        </div>}
      </>
    )}
  </div>;
}

export function GoalPaceSetup({
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
  const current=today(profile.timeZone);
  const live=calculateLivePace(profile,undefined,acceptedExpenditure,current);
  const bmi=profile.heightCm>0?profile.weightKg/Math.pow(profile.heightCm/100,2):null;
  const blockedReason=profileAge(profile,current)<18||profile.pregnancyOrBreastfeeding||profile.medicalNutrition
    ?'Automated targets are unavailable for this profile. You can still keep a food and weight diary.'
    :loss&&bmi!=null&&bmi<18.5?'Weight-loss coaching is unavailable at an underweight BMI.':null;

  const paceStatus=paced
    ?getPaceStatus(
        profile.goal??'lose',
        rate,
        live.isFloored,
        units.energy,
        live.expenditure,
        live.target
      )
    :undefined;

  return <div className="goal-pace-setup">
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
        {paced&&<span className="live-delta">
          {live.change<0?'−':'+'}{displayEnergy(Math.abs(live.change),units.energy)} {energyLabel(units.energy)} · {Math.abs(rate).toFixed(2)}% bodyweight/week
        </span>}
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
      recommendedRange={loss?[-1.0,-0.5]:[0.1,0.25]}
      recommendedLabel={loss?'0.5–1.0% / week':'0.10–0.25% / week'}
      valueDisplay={paceStatus&&(
        <div className="slider-value-group">
          <span className={`slider-pace-badge ${paceStatus.tone}`}>{paceStatus.label}</span>
          <span className="slider-current-badge">{rate>0?'+':''}{rate.toFixed(2)}% / week</span>
        </div>
      )}
      hint={paceStatus?.hint}
    />}
    {!paced&&<p className="source">Maintenance uses a fixed 0% bodyweight change rate.</p>}
  </div>;
}

export function GoalSetup(props:{
  profile:ProfileDraft;
  set:(key:keyof ProfileDraft,value:unknown)=>void;
  acceptedExpenditure?:number|null;
  units:UnitPreferences;
}){
  return <CoachLayout className="goal-setup">
    <GoalPaceSetup {...props}/>
    <GoalPhaseSetup profile={props.profile} set={props.set} units={props.units}/>
  </CoachLayout>;
}

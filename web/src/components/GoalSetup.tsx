import {Check} from 'lucide-react';
import type {ProfileDraft,UnitPreferences,Weight,WeightGoalMetric} from '../types';
import {today} from '../lib/format';
import {calculateLivePace,getPaceStatus,profileAge} from '../lib/coachCalc';
import {Field,SelectField} from './ui/Field';
import {FieldFrame} from './ui/Form';
import {CircularSlider,Slider} from './ui/Slider';
import {CoachLayout,CoachNumber} from './ui/CoachMotion';
import {displayEnergy,displayWeight,energyLabel,weightLabel} from '../lib/units';
import {goalLabel} from './Coach';
import {goalWeightBounds,phaseEndDate,resolveGoalStartWeight} from '../lib/goalPhase';

export function GoalSelection({
  profile,
  set
}:{
  profile:ProfileDraft;
  set:(key:keyof ProfileDraft,value:unknown)=>void;
}){
  return <FieldFrame label="Your goal"><fieldset className="coach-goals"><legend>Your goal</legend><div className="coach-goal-options">
    {(['lose','maintain','gain'] as const).map(goal=><label key={goal} htmlFor={`coach-goal-${goal}`} className={`coach-goal-option ${profile.goal===goal?'selected':''}`}>
      <input id={`coach-goal-${goal}`} required type="radio" name="coach-goal" value={goal} checked={profile.goal===goal} onChange={()=>set('goal',goal)}/>
      <span>{goalLabel(goal)}</span><Check size={16} aria-hidden="true"/>
    </label>)}
  </div></fieldset></FieldFrame>;
}

export function GoalPhaseSetup({
  profile,
  set,
  units,
  weights=[],
  trendSeed=[],
  weightGoalMetric='scale',
  currentWeightKg
}:{
  profile:ProfileDraft;
  set:(key:keyof ProfileDraft,value:unknown)=>void;
  units:UnitPreferences;
  weights?:readonly Weight[];
  trendSeed?:readonly Weight[];
  weightGoalMetric?:WeightGoalMetric;
  currentWeightKg?:number;
}){
  const loss=profile.goal==='lose';
  const paced=profile.goal==='lose'||profile.goal==='gain';
  const current=today(profile.timeZone);
  const startWeight=resolveGoalStartWeight({fallbackKg:currentWeightKg??profile.weightKg,weights,trendSeed,metric:weightGoalMetric,current});
  const mode=profile.phaseMode??(profile.goal==='maintain'?'duration':'weight');
  const durationWeeks=profile.durationWeeks??8;
  const bounds=goalWeightBounds(profile.goal,startWeight,profile.heightCm);
  const requestedTarget=profile.targetWeightKg??startWeight;
  const targetWeight=Math.min(Math.max(requestedTarget,bounds.min),bounds.max);
  const bmi=profile.heightCm>0?profile.weightKg/Math.pow(profile.heightCm/100,2):null;
  const blockedReason=profileAge(profile,current)<18||profile.pregnancyOrBreastfeeding||profile.medicalNutrition
    ?'Automated targets are unavailable for this profile. You can still keep a food and weight diary.'
    :loss&&bmi!=null&&bmi<18.5?'Weight-loss coaching is unavailable at an underweight BMI.':null;
  const targetError=()=>{
    if(!paced)return undefined;
    if(requestedTarget<bounds.min||requestedTarget>bounds.max)return `Choose a target between ${displayWeight(bounds.min,units.weight,1)} and ${displayWeight(bounds.max,units.weight,1)} ${weightLabel(units.weight)}.`;
    if(profile.goal==='lose'&&targetWeight>=startWeight)return 'Choose a target below your current weight.';
    if(profile.goal==='gain'&&targetWeight<=startWeight)return 'Choose a target above your current weight.';
    if(profile.goal==='lose'&&profile.heightCm>0&&targetWeight/Math.pow(profile.heightCm/100,2)<18.5)return 'Choose a target with a BMI of at least 18.5.';
    return undefined;
  };
  const weightValueDisplay=(value:number)=><div className="target-weight-value">
    <strong><CoachNumber>{displayWeight(value,units.weight,1)}</CoachNumber></strong>
    <span>{weightLabel(units.weight)}</span>
    <small>{value<startWeight?`${displayWeight(startWeight-value,units.weight,1)} ${weightLabel(units.weight)} to lose`:value>startWeight?`${displayWeight(value-startWeight,units.weight,1)} ${weightLabel(units.weight)} to gain`:'Current weight'}</small>
  </div>;
  const durationValueDisplay=(value:number)=><div className="slider-value-group">
    <span className="slider-current-badge"><CoachNumber>{value}</CoachNumber> weeks</span>
    <span className="slider-equivalent">Ends {phaseEndDate(current,value)}</span>
  </div>;

  return <div className="goal-phase-setup">
    {blockedReason?<div className="notice"><p className="source">{blockedReason}</p></div>:(
      <>
        <SelectField id="goal-phase-mode" name="phaseMode" label="Track my goal by" value={mode} onChange={v=>{
          set('phaseMode',v);
          if(v==='duration'&&!profile.durationWeeks)set('durationWeeks',8);
          set('phaseStart',current);
          set('phaseStartWeightKg',startWeight);
          if(v==='weight'&&profile.targetWeightKg==null)set('targetWeightKg',startWeight);
        }}>
          {paced&&<option value="weight">Target weight</option>}
          <option value="duration">Duration</option>
          {profile.goal==='maintain'&&<option value="open">No end date</option>}
        </SelectField>

        {mode==='duration'&&<CircularSlider
          id="goal-duration-weeks"
          name="durationWeeks"
          label="How long should this phase run?"
          min={1}
          max={104}
          step={1}
          value={Math.min(Math.max(durationWeeks,1),104)}
          formatValue={value=>`${value} weeks`}
          valueDisplay={durationValueDisplay(Math.min(Math.max(durationWeeks,1),104))}
          onChange={value=>set('durationWeeks',value)}
          hint="The phase starts today. Use the arrow keys for one-week changes."
        />}

        {mode==='weight'&&paced&&<CircularSlider
          id="goal-target-weight"
          name="targetWeightKg"
          label={`Target weight (${weightLabel(units.weight)})`}
          min={bounds.min}
          max={bounds.max}
          step={0.1}
          value={targetWeight}
          formatValue={value=>`${displayWeight(value,units.weight,1)} ${weightLabel(units.weight)}`}
          centerValue={weightValueDisplay(targetWeight)}
          validate={targetError}
          onChange={value=>set('targetWeightKg',value)}
          hint={`From ${displayWeight(startWeight,units.weight,1)} ${weightLabel(units.weight)}. Choose a target within 20% of your starting weight${loss?' and above the BMI 18.5 floor':''}. Use arrow keys for 0.1 kg changes.`}
        />}
        {mode==='open'&&<p className="source">Maintenance continues without a scheduled end date. You can choose a new goal whenever you are ready.</p>}
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

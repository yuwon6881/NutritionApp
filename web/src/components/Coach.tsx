import {Form,FieldFrame,validateFields} from './ui/Form';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Sliders} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Profile,ProfileDraft,CoachResult,UnitPreferences} from '../types';
import {number,today} from '../lib/format';
import {normalizeProfileSex,profilesEqual} from '../lib/profile';
import {ageOn} from '../lib/age';
import {calculateLivePace,effectiveSplit,storedSplit} from '../lib/coachCalc';
import {gramsFromSplit,macroKeys,macroLabels,macroPresets,type MacroSplit} from '../lib/macros';
import {Button} from './ui/Button';
import {SegmentedControl} from './ui/SegmentedControl';
import {Field,SelectField} from './ui/Field';
import {DatePicker} from './ui/DatePicker';
import {GoalSetup} from './GoalSetup';
import {MacroSetup} from './MacroSetup';
import {WeeklyProgramSetup} from './WeeklyProgramSetup';
import {allocateWeeklyCalories,normaliseDistribution} from '../lib/dailyTargets';
import {CoachLayout,CoachWait,useCoachSteps} from './ui/CoachMotion';
import {useCoachProposal} from '../useCoachProposal';
import {MiniUnitToggle} from './ui/MiniUnitToggle';
import {cmFromHeightParts,displayEnergy,displayHeight,displayWeight,energyLabel,heightPartsFromCm,inputEnergy,inputWeight,parseEnergy,parseWeight,unitsFor,weightLabel} from '../lib/units';
import {useAsyncAction} from './ui/useAsyncAction';

const defaults:ProfileDraft={
  age:0,
  dateOfBirth:null,
  heightCm:0,
  weightKg:0,
  sex:'',
  activity:0,
  goal:'',
  maintenance:null,
  proteinGrams:null,
  resistanceTraining:false,
  pregnancyOrBreastfeeding:false,
  medicalNutrition:false,
  timeZone:'Asia/Kuala_Lumpur',
  phaseMode:'open',
  durationWeeks:8,
  phaseStart:null,
  targetWeightKg:null,
  phaseStartWeightKg:null,
  goalRatePercent:0,
  distributionShares:null,
  energyAdjustmentPercent:0,
  proteinPercent:null,
  carbsPercent:null,
  fatPercent:null,
  macroPreset:null
};

type StepKey='body'|'activity'|'goal'|'macros'|'macro-adjustments'|'distribution'|'review';
type MainTab='targets'|'plan'|'history';
const stepOrder=['body','activity','goal','macros','macro-adjustments','distribution','review'] as const;

const goalLabel=(goal:string)=>goal==='lose'?'Fat loss':goal==='gain'?'Bulking':'Maintenance';
const presetLabel=(id:string|null|undefined)=>macroPresets.find(p=>p.id===id)?.label??'Custom';

function TargetFigures({result,units}:{result:CoachResult;units:UnitPreferences}){
  return <div className="target-figures">
    <div><p>Daily energy</p><strong>{displayEnergy(result.calories,units.energy)} <span className="unit">{energyLabel(units.energy)}</span></strong></div>
    <div><p>Maintenance</p><strong>{displayEnergy(result.expenditure,units.energy)} <span className="unit">{energyLabel(units.energy)}</span></strong></div>
    <div><p><span className="macro-dot protein" aria-hidden="true"/>Protein</p><strong>{number(result.protein)} <span className="unit">g</span></strong></div>
    <div><p><span className="macro-dot carbs" aria-hidden="true"/>Carbohydrate</p><strong>{number(result.carbs)} <span className="unit">g</span></strong></div>
    <div><p><span className="macro-dot fat" aria-hidden="true"/>Fat</p><strong>{number(result.fat)} <span className="unit">g</span></strong></div>
    {result.dailyCalories?.length===7&&<div className="target-weekly-summary"><p>Weekly budget</p><strong>{displayEnergy(result.weeklyCalories,units.energy)} <span className="unit">{energyLabel(units.energy)}</span></strong><small>{result.dailyCalories.map((calories,index)=><span key={index}>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][index]} {displayEnergy(calories,units.energy)} {energyLabel(units.energy)}</span>)}</small></div>}
  </div>;
}

export function Coach({store,onboarding=false}:{store:Nourish;onboarding?:boolean}){
  const [profile,setProfile]=useState<ProfileDraft>(()=>normalizeProfileSex(store.state!.profile??defaults));
  const [message,setMessage]=useState('');
  const {busy:saving,run:runSave}=useAsyncAction();
  const [mainTab,setMainTab]=useState<MainTab>('targets');
  const [review,setReview]=useState(false);
  const [weeklyDraft,setWeeklyDraft]=useState<number[]>();
  const {step,go:setStep,stage}=useCoachSteps<StepKey>('body',stepOrder,`${mainTab}-${review}`);
  const reviewPanel=useRef<HTMLElement>(null);
  useEffect(()=>{if(review)reviewPanel.current?.focus({preventScroll:true});},[review]);

  const plans=store.state!.plans.filter(p=>!p.deleted);
  const isInitialSetup=onboarding||plans.length===0;

  // Profile edits create a proposal; the newest accepted plan remains active
  // until the user explicitly accepts that proposal.
  const accepted=plans[0];
  const acceptedPlan:CoachResult|undefined=accepted?JSON.parse(accepted.resultJson):undefined;
  const current=today(store.state!.profile?.timeZone);
  const settings=store.state!.settings??{checkInWeekday:1,revision:0};
  const units=unitsFor(settings);
  const derivedAge=ageOn(profile.dateOfBirth,current);
  const pending=store.local!.queue.length>0;
  const changed=!profilesEqual(profile,store.state!.profile);
  const proposalFlow=useCoachProposal({store,draft:profile,changed,
    onAccepted:refreshed=>{setMessage('Plan active.');if(refreshed){setReview(false);setMainTab('targets');}}});
  const {proposal,operation:proposalOperation,setOperation,error,setError,setProposal,setWantsProposal,acceptProposal,retryRefresh:refreshTargets,
    loadProposal:requestProposal,invalidate,acceptance,locked,online}=proposalFlow;
  const operation=saving?'saving':proposalOperation;
  const busy=saving||proposalFlow.busy;

  const updateUnits=(patch:Partial<UnitPreferences>)=>{
    const next={...units,...patch};
    void store.mutate({kind:'settings',recordId:store.state!.id,expectedRevision:settings.revision,data:{checkInWeekday:settings.checkInWeekday,weightUnit:next.weight,energyUnit:next.energy,heightUnit:next.height,missingDayAction:settings.missingDayAction??'ask'},delete:false});
  };

  const set=(key:keyof Profile,value:unknown)=>{
    invalidate();
    if(key!=='distributionShares')setWeeklyDraft(undefined);
    setProfile(p=>normalizeProfileSex({
      ...p,
      [key]:value,
      // The stored age mirrors the date of birth so an older record stays consistent offline.
      ...(key==='dateOfBirth'?{age:ageOn(value as string,current)??p.age}:{}),
      ...(key==='goal'?{
        goalRatePercent:value==='lose'?-0.5:value==='gain'?0.15:0,
        energyAdjustmentPercent:value==='lose'?15:value==='gain'?5:0,
        ...(value==='maintain'?{phaseMode:'open' as const}:{})
      }:{})
    }));
    setProposal(undefined);
  };

  const setSplit=(next:MacroSplit|null,preset:string|null)=>{
    invalidate();
    setProfile(p=>({...p,
      proteinPercent:next?.protein??null,
      carbsPercent:next?.carbs??null,
      fatPercent:next?.fat??null,
      macroPreset:preset,
      // A chosen split owns every macro, so a stale gram override cannot silently win.
      proteinGrams:next?null:p.proteinGrams}));
    setProposal(undefined);
  };

  const loadProposal=()=>{setReview(true);void requestProposal();};

  const retryRefresh=async()=>{await refreshTargets();if(proposalFlow.operation!=='refresh-error')setReview(false);};

  const live=calculateLivePace(profile,undefined,acceptedPlan?.expenditure,current);
  const weeklyValues=weeklyDraft??(profile.distributionShares?.length===7
    ?allocateWeeklyCalories(live.weeklyCalories,profile.distributionShares)
    :live.dailyCalories);
  const weeklyValid=weeklyValues.length===7&&weeklyValues.every(value=>Number.isInteger(value)&&value>=0)&&Math.abs(weeklyValues.reduce((sum,value)=>sum+value,0)-Math.round(live.weeklyCalories))<=2;
  const split=storedSplit(profile)??effectiveSplit(profile,acceptedPlan?.expenditure,current);
  const canAdvanceBody=Boolean(derivedAge!=null&&derivedAge>=13&&derivedAge<=120&&profile.heightCm>=80&&profile.heightCm<=250&&profile.weightKg>=20&&profile.weightKg<=400&&profile.sex);
  const canAdvanceActivity=Boolean(profile.activity>=1.2&&profile.activity<=2.5&&(profile.maintenance==null||(profile.maintenance>=1000&&profile.maintenance<=7000)));
  const phaseInitial=profile.phaseStartWeightKg??profile.weightKg;
  const target=profile.targetWeightKg;
  const canAdvanceGoal=Boolean(profile.goal
    &&(profile.phaseMode!=='duration'||(profile.durationWeeks!=null&&profile.durationWeeks>=1&&profile.durationWeeks<=104&&Number.isInteger(profile.durationWeeks)&&!!profile.phaseStart&&profile.phaseStart>='2000-01-01'&&profile.phaseStart<=current))
    &&(profile.phaseMode!=='weight'||(target!=null&&target>=20&&target<=400&&phaseInitial>=20&&phaseInitial<=400&&(profile.goal==='lose'?target<phaseInitial&&target/Math.pow(profile.heightCm/100,2)>=18.5:profile.goal==='gain'&&target>phaseInitial))));

  const openPlan=(target:StepKey='body')=>{if(locked.current||acceptance.current)return;invalidate();setReview(false);setError('');setMessage('');setMainTab('plan');setStep(target);};

  const submitProfile=async()=>{
    if(locked.current||step!=='review')return;
    if(!canAdvanceBody){setStep('body');setError('Review your body measurements and date of birth.');return;}
    if(!canAdvanceActivity){setStep('activity');setError('Choose your usual activity.');return;}
    if(!canAdvanceGoal){setStep('goal');setError('Review your goal and phase details.');return;}
    if(!weeklyValid){setError(`Your seven daily energy values must total exactly ${displayEnergy(Math.round(live.weeklyCalories),units.energy)} ${energyLabel(units.energy)}.`);return;}
    locked.current=true;setError('');
    try{
    await runSave(()=>store.mutate({
        kind:'profile',
        recordId:store.state!.id,
        expectedRevision:store.state!.profileRevision,
        data:profile,
        delete:false
      }));
    setProposal(undefined);
    setReview(true);
    setWantsProposal(true);
    setOperation('waiting');
    setMainTab('plan');
    setMessage('');
    }catch(ex){setError((ex as Error).message);setOperation('error');}
    finally{locked.current=false;}
  };

  const steps=[
    {id:'body',label:'Body'},
    {id:'activity',label:'Activity'},
    {id:'goal',label:'Goal'},
    {id:'macros',label:'Macros'},
    {id:'macro-adjustments',label:'Adjust'},
    {id:'distribution',label:'Distribution'},
    {id:'review',label:'Review'}
  ] as const;
  const stepIndex=stepOrder.indexOf(step);

  const selectedPresetId=profile.macroPreset??(storedSplit(profile)?'custom':'auto');
  const reviewGrams=gramsFromSplit(live.target,split);
  const weeklyError=`Your seven daily energy values must total exactly ${displayEnergy(Math.round(live.weeklyCalories),units.energy)} ${energyLabel(units.energy)}.`;
  const canNavigateTo=(targetStep:StepKey)=>{
    if(stepOrder.indexOf(targetStep)<stepOrder.indexOf(step))return true;
    if(!validateFields(stage.current))return false;
    if(targetStep==='review'&&!weeklyValid){setError(weeklyError);return false;}
    return true;
  };

  const queueError=store.local!.queue.find(op=>op.error)?.error;
  const waitingLabel=!online?'Profile retained on this device. Waiting for a connection.'
    :queueError?'Resolve the retained edit conflict to calculate targets.'
    :changed&&!pending?'Your profile changed. Return to edit before calculating targets.'
    :store.error?'Profile retained. Waiting for the connection to recover.'
    :'Profile retained. Waiting for synchronization…';
  const operationLabel=operation==='saving'?'Saving on this device…':operation==='waiting'?waitingLabel
    :operation==='updating'?'Updating proposal…':operation==='accepting'?'Activating plan…'
    :operation==='refreshing'?'Loading active targets…':'Calculating targets…';
  const proposalPanel=review?<section ref={reviewPanel} tabIndex={-1} aria-label="Plan review" className="panel proposal-card"><CoachLayout>
    {proposal?<>
    <div className="section-heading">
      <div><h2>Proposed targets</h2></div>
      <Button size="md" variant="primary" disabled={busy||pending||!online||!proposal.canAccept} onClick={()=>void acceptProposal()}>
        {operation==='accepting'?'Activating plan…':operation==='updating'?'Updating proposal…':'Accept this plan'}
      </Button>
    </div>
    <TargetFigures result={proposal.result} units={units}/>
    {proposal.holdReason&&<p className="notice">{proposal.holdReason}</p>}
    {!proposal.canAccept&&!proposal.holdReason&&<p className="notice">{proposal.result.explanation}</p>}
    </>:<h2>{message?'Active plan':'Review plan'}</h2>}
    {(busy||operation==='waiting')&&<CoachWait label={operationLabel} active={operation!=='waiting'||(online&&!queueError&&!store.error)}/>}
    {operation==='error'&&!proposal&&<Button onClick={()=>void loadProposal()} disabled={!online||pending||changed}>Retry calculation</Button>}
    {operation==='refresh-error'&&<Button onClick={()=>void retryRefresh()}>Retry loading targets</Button>}
    <div className="coach-review-actions"><Button variant="tertiary" disabled={!!acceptance.current||operation==='saving'||operation==='accepting'||operation==='updating'||operation==='refreshing'} onClick={()=>openPlan('macros')}><ArrowLeft size={16}/>Back to edit</Button></div>
  </CoachLayout></section>:null;

  const targetsTab=<>
    {acceptedPlan&&<section className="panel">
      <div className="section-heading">
        <div>
          <h2>Active targets</h2>
          <p>Accepted daily nutrition plan and macronutrient distribution.</p>
        </div>
        <div className="actions">
          <Button variant="secondary" size="md" disabled={busy||!!acceptance.current} onClick={()=>openPlan()}><Sliders size={16}/>Edit plan</Button>
        </div>
      </div>
      <TargetFigures result={acceptedPlan} units={units}/>
    </section>}
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Strategy</h2>
          <p>Phase configuration and baseline profile parameters.</p>
        </div>
      </div>
      <dl className="strategy-figures">
        <div><dt>Goal</dt><dd>{goalLabel(profile.goal||'maintain')}</dd></div>
        <div><dt>Pace</dt><dd>{!profile.goal||profile.goal==='maintain'?'—':`${Math.abs(profile.goalRatePercent??(profile.goal==='lose'?-0.5:0.15))}% bodyweight/week`}</dd></div>
        <div><dt>{profile.phaseMode==='duration'?'Duration':profile.phaseMode==='weight'?'Target':'Phase'}</dt><dd>{profile.phaseMode==='duration'?`${profile.durationWeeks} weeks`:profile.phaseMode==='weight'?`${displayWeight(profile.targetWeightKg,units.weight,1)} ${weightLabel(units.weight)}`:'Ongoing'}</dd></div>
        <div><dt>Macros</dt><dd>{presetLabel(storedSplit(profile)?profile.macroPreset??'custom':'auto')}</dd></div>
        <div><dt>Body</dt><dd>{displayWeight(profile.weightKg,units.weight,1)} {weightLabel(units.weight)} · {displayHeight(profile.heightCm,units.height)}</dd></div>
        <div><dt>Age</dt><dd>{derivedAge??profile.age}</dd></div>
      </dl>
    </section>
  </>;

  const planTab=<section className="panel">
    <div className="section-heading">
      <div><h2>{isInitialSetup?'Set up profile':'Edit plan'}</h2></div>
      {!isInitialSetup&&<Button variant="tertiary" size="md" onClick={()=>{setMessage('');setMainTab('targets');}}>
        <ArrowLeft size={16}/>Targets
      </Button>}
    </div>

    <Form onSubmit={e=>{e.preventDefault();if(step==='review')void submitProfile();else {const nextStep=stepOrder[stepOrder.indexOf(step)+1];if(nextStep&&canNavigateTo(nextStep))setStep(nextStep);}}}>
      <CoachLayout><div ref={stage} className="coach-step-stage" data-step={step}>
      <div className="coach-step-progress" aria-label={`Plan progress: step ${stepIndex+1} of ${steps.length}, ${steps[stepIndex].label}`}>
        <div className="coach-step-progress-label"><span>Step {stepIndex+1} of {steps.length}</span><h3 tabIndex={-1} data-step-heading className="coach-step-heading">{steps[stepIndex].label}</h3></div>
        <div className="coach-step-progress-track" role="progressbar" aria-label="Plan completion" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={stepIndex+1}>
          <span style={{width:`${((stepIndex+1)/steps.length)*100}%`}}/>
        </div>
      </div>
      {step==='body'&&<div className="step-content">
        <div className="form-grid">
          <DatePicker id="coach-date-of-birth" name="dateOfBirth" validate={()=>derivedAge!=null&&(derivedAge<13||derivedAge>120)?'Enter a date of birth for an age from 13 to 120.':undefined} label="Date of birth" required min="1900-01-01" max={current} value={profile.dateOfBirth??''} onChange={v=>set('dateOfBirth',v)} hint={derivedAge!=null?`Age ${derivedAge}`:undefined}/>
          {units.height==='cm'?(
            <Field id="coach-height" name="heightCm" label="Height (cm)" type="number" required min="80" max="250" step="0.1" value={profile.heightCm||''} onChange={e=>set('heightCm',Number(e.target.value)||0)} labelAction={<MiniUnitToggle<'cm'|'ft-in'> label="Height unit" value={units.height} onChange={v=>updateUnits({height:v})} options={[{value:'cm',label:'cm'},{value:'ft-in',label:'ft'}]}/>}/>
          ):(
            <FieldFrame label="Height (ft / in)" className="field">
              <div className="field-label-row">
                <label htmlFor="coach-height-feet">Height (ft / in)</label>
                <MiniUnitToggle<'cm'|'ft-in'> label="Height unit" value={units.height} onChange={v=>updateUnits({height:v})} options={[{value:'cm',label:'cm'},{value:'ft-in',label:'ft'}]}/>
              </div>
              <div className="height-ft-in-group">
                <div className="height-ft-in-field">
                  <input
                    id="coach-height-feet"
                    name="heightFeet"
                    aria-label="Height (feet)"
                    type="number"
                    required
                    min="2"
                    max="8"
                    step="1"
                    placeholder="ft"
                    value={profile.heightCm?heightPartsFromCm(profile.heightCm).feet:''}
                    onChange={e=>{
                      const parts=heightPartsFromCm(profile.heightCm||0);
                      const next=cmFromHeightParts(e.target.value,String(parts.inches));
                      set('heightCm',Number.isFinite(next)?next:0);
                    }}
                  />
                  <span className="unit-affix">ft</span>
                </div>
                <div className="height-ft-in-field">
                  <input
                    id="coach-height-inches"
                    name="heightInches"
                    aria-label="Height (inches)"
                    type="number"
                    required
                    min="0"
                    max="11.9"
                    step="0.1"
                    placeholder="in"
                    value={profile.heightCm?heightPartsFromCm(profile.heightCm).inches:''}
                    onChange={e=>{
                      const parts=heightPartsFromCm(profile.heightCm||0);
                      const next=cmFromHeightParts(String(parts.feet),e.target.value);
                      set('heightCm',Number.isFinite(next)?next:0);
                    }}
                  />
                  <span className="unit-affix">in</span>
                </div>
              </div>
            </FieldFrame>
          )}
          <Field id="coach-weight" name="weightKg" label={`Starting weight (${weightLabel(units.weight)})`} type="number" required min={units.weight==='lb'?44.1:20} max={units.weight==='lb'?881.8:400} step="0.1" value={profile.weightKg?inputWeight(profile.weightKg,units.weight,1):''} onChange={e=>{const next=parseWeight(e.target.value,units.weight);set('weightKg',Number.isFinite(next)?next:0);}} labelAction={<MiniUnitToggle<'kg'|'lb'> label="Weight unit" value={units.weight} onChange={v=>updateUnits({weight:v})} options={[{value:'kg',label:'kg'},{value:'lb',label:'lb'}]}/>}/>
          <SelectField id="coach-sex" name="sex" required label="Sex parameter for equation" value={profile.sex} onChange={v=>set('sex',v)}>
            <option value="" disabled>Choose an equation parameter</option>
            <option value="female">Female equation</option>
            <option value="male">Male equation</option>
          </SelectField>
        </div>
        <div className="step-actions">
          <Button type="button" size="md" variant="primary" onClick={()=>{if(validateFields(stage.current))setStep('activity');}}>
            Next: Activity <ArrowRight size={16}/>
          </Button>
        </div>
      </div>}

      {step==='activity'&&<div className="step-content">
        <SelectField id="coach-activity" name="activity" required label="Usual activity (approximate)" value={profile.activity?String(profile.activity):''} onChange={v=>set('activity',Number(v))}>
          <option value="" disabled>Choose your usual activity</option>
          <option value="1.2">Very little activity · 1.2</option>
          <option value="1.4">Mostly sitting, some walking · 1.4</option>
          <option value="1.6">Moderately active · 1.6</option>
          <option value="1.8">Active most days · 1.8</option>
          <option value="2.0">Very active · 2.0</option>
        </SelectField>
        <Field id="coach-maintenance" name="maintenance" label={`Known maintenance calories${units.energy==='kcal'?'':` (${energyLabel(units.energy)})`} (optional)`} type="number" min={units.energy==='kj'?4184:1000} max={units.energy==='kj'?29288:7000} value={profile.maintenance==null?'':inputEnergy(profile.maintenance,units.energy,0)} placeholder="Use the equation" onChange={e=>{const next=parseEnergy(e.target.value,units.energy);set('maintenance',e.target.value===''?null:Number.isFinite(next)?next:null);}} labelAction={<MiniUnitToggle<'kcal'|'kj'> label="Energy unit" value={units.energy} onChange={v=>updateUnits({energy:v})} options={[{value:'kcal',label:'kcal'},{value:'kj',label:'kJ'}]}/>}/>
        <div className="checks">
          <label htmlFor="coach-resistance-training">
            <input id="coach-resistance-training" name="resistanceTraining" type="checkbox" role="switch" aria-checked={profile.resistanceTraining} checked={profile.resistanceTraining} onChange={e=>set('resistanceTraining',e.target.checked)}/>
            Resistance training
          </label>
          {([['pregnancyOrBreastfeeding','Pregnant or breastfeeding'],['medicalNutrition','Medically managed nutrition']] as const).filter(([key])=>key!=='pregnancyOrBreastfeeding'||profile.sex!=='male').map(([key,label])=><label key={key} htmlFor={`coach-${key}`}>
            <input id={`coach-${key}`} name={key} type="checkbox" role="switch" aria-checked={profile[key]} checked={profile[key]} onChange={e=>set(key,e.target.checked)}/>{label}
          </label>)}
        </div>
        <div className="step-actions">
          <Button type="button" size="md" variant="secondary" onClick={()=>setStep('body')}><ArrowLeft size={16}/> Back</Button>
          <Button type="button" size="md" variant="primary" onClick={()=>{if(validateFields(stage.current))setStep('goal');}}>
            Next: Goal <ArrowRight size={16}/>
          </Button>
        </div>
      </div>}

      {step==='goal'&&<div className="step-content">
        <FieldFrame label="Your goal"><fieldset className="coach-goals"><legend>Your goal</legend><div className="coach-goal-options">
          {(['lose','maintain','gain'] as const).map(goal=><label key={goal} htmlFor={`coach-goal-${goal}`} className={`coach-goal-option ${profile.goal===goal?'selected':''}`}>
            <input id={`coach-goal-${goal}`} required type="radio" name="coach-goal" value={goal} checked={profile.goal===goal} onChange={()=>set('goal',goal)}/>
            <span>{goalLabel(goal)}</span><Check size={16} aria-hidden="true"/>
          </label>)}
        </div></fieldset></FieldFrame>
        <GoalSetup profile={profile} set={set} acceptedExpenditure={acceptedPlan?.expenditure} units={units}/>
        <div className="step-actions">
          <Button type="button" size="md" variant="secondary" onClick={()=>setStep('activity')}><ArrowLeft size={16}/> Back</Button>
          <Button type="button" size="md" variant="primary" onClick={()=>{if(validateFields(stage.current))setStep('macros');}}>
            Next: Macros <ArrowRight size={16}/>
          </Button>
        </div>
      </div>}

      {step==='macros'&&<div className="step-content">
        <p className="step-description">Choose a starting macro pattern. You can fine-tune its percentages on the next step.</p>
        <MacroSetup
          calories={live.target}
          split={split}
          mode="presets"
          presetId={selectedPresetId}
          onChange={next=>setSplit(next,'custom')}
          onPreset={(id,next)=>setSplit(next,id==='auto'?null:id)}
        />
        <div className="step-actions">
          <Button type="button" size="md" variant="secondary" onClick={()=>setStep('goal')}><ArrowLeft size={16}/> Back</Button>
          <Button type="button" size="md" variant="primary" onClick={()=>setStep('macro-adjustments')}>
            Next: Adjust <ArrowRight size={16}/>
          </Button>
        </div>
      </div>}

      {step==='macro-adjustments'&&<div className="step-content">
        <p className="step-description">Adjust each macro when you want a different split. The total always stays at 100%.</p>
        <MacroSetup
          calories={live.target}
          split={split}
          mode="adjustments"
          presetId={selectedPresetId}
          onChange={next=>setSplit(next,'custom')}
          onPreset={(id,next)=>setSplit(next,id==='auto'?null:id)}
        />
        <p className="source macro-selection-note">Starting pattern: <strong>{presetLabel(selectedPresetId)}</strong></p>
        <div className="step-actions">
          <Button type="button" size="md" variant="secondary" onClick={()=>setStep('macros')}><ArrowLeft size={16}/> Back</Button>
          <Button type="button" size="md" variant="primary" onClick={()=>{if(validateFields(stage.current))setStep('distribution');}}>
            Next: Distribution <ArrowRight size={16}/>
          </Button>
        </div>
      </div>}

      {step==='distribution'&&<div className="step-content">
        <p className="step-description">Keep the same weekly calorie budget while choosing how it lands across the week.</p>
        <WeeklyProgramSetup
          budget={live.weeklyCalories}
          values={weeklyValues}
          energyUnit={units.energy}
          custom={Boolean(profile.distributionShares && !profile.distributionShares.every((v, _, a) => Math.abs(v - a[0]) < 0.01))}
          onChange={(values, isCustom)=>{
            setWeeklyDraft(values);
            set('distributionShares', isCustom ? normaliseDistribution(values) : null);
          }}
        />
        <div className="step-actions">
          <Button type="button" size="md" variant="secondary" onClick={()=>setStep('macro-adjustments')}><ArrowLeft size={16}/> Back</Button>
          <Button type="button" size="md" variant="primary" onClick={()=>{if(weeklyValid)setStep('review');else setError(weeklyError);}}>
            Next: Review <ArrowRight size={16}/>
          </Button>
        </div>
      </div>}

      {step==='review'&&<div className="step-content">
        <p className="step-description">Review your choices before saving this profile and calculating targets.</p>
        <section className="macro-review-summary" aria-labelledby="macro-review-title">
          <div className="section-heading">
            <div><h3 id="macro-review-title">Plan summary</h3><p>{presetLabel(selectedPresetId)} macro pattern</p></div>
          </div>
          <dl className="strategy-figures">
            <div><dt>Goal</dt><dd>{goalLabel(profile.goal||'maintain')}</dd></div>
            <div><dt>Daily target</dt><dd>{displayEnergy(live.target,units.energy)} {energyLabel(units.energy)}</dd></div>
            <div><dt>Weekly budget</dt><dd>{displayEnergy(live.weeklyCalories,units.energy)} {energyLabel(units.energy)}</dd></div>
          </dl>
          <div className="macro-review-grid">
            {macroKeys.map(key=><div key={key}>
              <span className={`macro-swatch ${key}`} aria-hidden="true"/>
              <span>{macroLabels[key]}</span>
              <strong>{split[key]}% <small>{reviewGrams[key]} g</small></strong>
            </div>)}
          </div>
          <div className="weekly-review-summary">
            <strong>Daily calories</strong>
            <div>{weeklyValues.map((value,index)=><span key={index}><small>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][index]}</small>{displayEnergy(value,units.energy)}</span>)}</div>
          </div>
        </section>
        <div className="step-actions">
          <Button type="button" size="md" variant="secondary" onClick={()=>setStep('distribution')}><ArrowLeft size={16}/> Back</Button>
          <Button variant="primary" size="md" type="submit" disabled={busy||!weeklyValid}>
            {operation==='saving'?'Saving on this device…':isInitialSetup?'Create my starting estimate':'Save profile'}
          </Button>
        </div>
      </div>}
      </div></CoachLayout>
    </Form>
  </section>;

  const historyTab=<>
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Accepted plans</h2>
          <p>History of previously accepted coaching targets and macronutrient distributions.</p>
        </div>
      </div>
      {plans.length===0?<p>No accepted plans yet.</p>:<dl className="plan-list">
        {plans.map(plan=>{
          const result=JSON.parse(plan.resultJson) as CoachResult;
          return <div key={plan.id}>
            <dt>{plan.date}</dt>
            <dd>{displayEnergy(result.calories,units.energy)} {energyLabel(units.energy)} · {number(result.protein)} / {number(result.carbs)} / {number(result.fat)} g</dd>
          </div>;
        })}
      </dl>}
    </section>
  </>;

  return <>
    <header className="page-heading">
      <div><h1 data-page-heading tabIndex={-1}>Coach</h1></div>
    </header>

    {!isInitialSetup&&<SegmentedControl<MainTab> className="section-segments" label="Coach sections" value={mainTab}
      options={[{value:'targets',label:'Targets'},{value:'plan',label:'Plan',disabled:operation==='accepting'||operation==='updating'||operation==='refreshing'||!!acceptance.current},{value:'history',label:'History'}]}
      onChange={value=>{if(value==='plan')openPlan(step);else {setMessage('');setMainTab(value);}}}/>}

    {message&&<p className="status-banner coach-success" role="status"><Check size={18} aria-hidden="true"/>{message}</p>}
    {error&&<p className="error" role="alert">{error}</p>}

    <div key={isInitialSetup?(review?'review':'setup'):mainTab} className="coach-tab-scene">
    {isInitialSetup?<>{review?proposalPanel:planTab}</>
    :mainTab==='targets'?targetsTab
      :mainTab==='plan'?(review?proposalPanel:planTab)
      :historyTab}</div>
  </>;
}

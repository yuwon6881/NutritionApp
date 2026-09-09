import {Form,FieldFrame,validateFields} from './ui/Form';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Activity,Check,PieChart,Sliders,Target,User} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Profile,ProfileDraft,CoachResult} from '../types';
import {number,today} from '../lib/format';
import {profilesEqual} from '../lib/profile';
import {ageOn} from '../lib/age';
import {calculateLivePace,effectiveSplit,storedSplit} from '../lib/coachCalc';
import {macroPresets,type MacroSplit} from '../lib/macros';
import {liveGoalProgress,mergeGoalProgress} from '../lib/goalProgress';
import {Button} from './ui/Button';
import {SegmentedControl} from './ui/SegmentedControl';
import {Field,SelectField} from './ui/Field';
import {DatePicker} from './ui/DatePicker';
import {GoalSetup} from './GoalSetup';
import {GoalSummary} from './GoalSummary';
import {GoalReachedBanner} from './GoalReachedBanner';
import {CheckInCard} from './CheckInCard';
import {CheckInDialog} from './CheckInDialog';
import {MacroSetup} from './MacroSetup';
import {WeeklyProgramSetup} from './WeeklyProgramSetup';
import {allocateWeeklyCalories,normaliseDistribution} from '../lib/dailyTargets';
import {CoachLayout,CoachStepper,CoachWait,useCoachSteps} from './ui/CoachMotion';
import {useCoachProposal} from '../useCoachProposal';

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

type StepKey='body'|'activity'|'goal'|'macros';
type MainTab='targets'|'plan'|'history';
const stepOrder=['body','activity','goal','macros'] as const;

const goalLabel=(goal:string)=>goal==='lose'?'Fat loss':goal==='gain'?'Bulking':'Maintenance';
const presetLabel=(id:string|null|undefined)=>macroPresets.find(p=>p.id===id)?.label??'Custom';

function TargetFigures({result}:{result:CoachResult}){
  return <div className="target-figures">
    <div><p>Daily energy</p><strong>{number(result.calories)} <span className="unit">kcal</span></strong></div>
    <div><p>Maintenance</p><strong>{number(result.expenditure)} <span className="unit">kcal</span></strong></div>
    <div><p>Protein</p><strong>{number(result.protein)} <span className="unit">g</span></strong></div>
    <div><p>Carbohydrate</p><strong>{number(result.carbs)} <span className="unit">g</span></strong></div>
    <div><p>Fat</p><strong>{number(result.fat)} <span className="unit">g</span></strong></div>
    {result.dailyCalories?.length===7&&<div className="target-weekly-summary"><p>Weekly budget</p><strong>{number(result.weeklyCalories)} <span className="unit">kcal</span></strong><small>{result.dailyCalories.map((calories,index)=><span key={index}>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][index]} {number(calories)}</span>)}</small></div>}
  </div>;
}

export function Coach({store,onboarding=false}:{store:Nourish;onboarding?:boolean}){
  const [profile,setProfile]=useState<ProfileDraft>(store.state!.profile??defaults);
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  const [checkInOpen,setCheckInOpen]=useState(false);
  const [checkInRestore,setCheckInRestore]=useState<HTMLElement|null>(null);
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
  const derivedAge=ageOn(profile.dateOfBirth,current);
  const pending=store.local!.queue.length>0;
  const changed=!profilesEqual(profile,store.state!.profile);
  const proposalFlow=useCoachProposal({store,draft:profile,changed,
    onAccepted:refreshed=>{setMessage('Plan active.');if(refreshed)setReview(false);}});
  const {proposal,operation:proposalOperation,setOperation,error,setError,setProposal,setWantsProposal,acceptProposal,retryRefresh:refreshTargets,
    loadProposal:requestProposal,invalidate,acceptance,locked,online}=proposalFlow;
  const operation=saving?'saving':proposalOperation;
  const busy=saving||proposalFlow.busy;

  const set=(key:keyof Profile,value:unknown)=>{
    invalidate();
    if(key!=='distributionShares')setWeeklyDraft(undefined);
    setProfile(p=>({
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
  const weeklyValid=weeklyValues.length===7&&weeklyValues.every(value=>Number.isInteger(value)&&value>=0)&&weeklyValues.reduce((sum,value)=>sum+value,0)===Math.round(live.weeklyCalories);
  const split=storedSplit(profile)??effectiveSplit(profile,acceptedPlan?.expenditure,current);
  const weighIns=[...(store.state!.weightTrendSeed??[]),...store.state!.weights.filter(w=>!w.deleted)];
  const phaseDecision=store.state!.phaseDecisions?.find(decision=>decision.profileRevision===store.state!.profileRevision&&!decision.deleted);
  const goalProgress=mergeGoalProgress(acceptedPlan?.goalProgress,liveGoalProgress(store.state!.profile,weighIns,current,phaseDecision),phaseDecision);
  const canAdvanceBody=Boolean(derivedAge!=null&&derivedAge>=13&&derivedAge<=120&&profile.heightCm>=80&&profile.heightCm<=250&&profile.weightKg>=20&&profile.weightKg<=400&&profile.sex);
  const canAdvanceActivity=Boolean(profile.activity>=1.2&&profile.activity<=2.5&&(profile.maintenance==null||(profile.maintenance>=1000&&profile.maintenance<=7000)));
  const phaseInitial=profile.phaseStartWeightKg??profile.weightKg;
  const target=profile.targetWeightKg;
  const canAdvanceGoal=Boolean(profile.goal
    &&(profile.phaseMode!=='duration'||(profile.durationWeeks!=null&&profile.durationWeeks>=1&&profile.durationWeeks<=104&&Number.isInteger(profile.durationWeeks)&&!!profile.phaseStart&&profile.phaseStart>='2000-01-01'&&profile.phaseStart<=current))
    &&(profile.phaseMode!=='weight'||(target!=null&&target>=20&&target<=400&&phaseInitial>=20&&phaseInitial<=400&&(profile.goal==='lose'?target<phaseInitial&&target/Math.pow(profile.heightCm/100,2)>=18.5:profile.goal==='gain'&&target>phaseInitial))));

  const openPlan=(target:StepKey='body')=>{if(locked.current||acceptance.current)return;invalidate();setReview(false);setError('');setMessage('');setMainTab('plan');setStep(target);};

  const submitProfile=async()=>{
    if(locked.current||step!=='macros')return;
    if(!canAdvanceBody){setStep('body');setError('Review your body measurements and date of birth.');return;}
    if(!canAdvanceActivity){setStep('activity');setError('Choose your usual activity.');return;}
    if(!canAdvanceGoal){setStep('goal');setError('Review your goal and phase details.');return;}
    if(!weeklyValid){setError(`Your seven daily calories must total exactly ${number(Math.round(live.weeklyCalories))} kcal.`);return;}
    locked.current=true;setSaving(true);setError('');
    try{
    await store.mutate({
      kind:'profile',
      recordId:store.state!.id,
      expectedRevision:store.state!.profileRevision,
      data:profile,
      delete:false
    });
    setProposal(undefined);
    setReview(true);
    setWantsProposal(true);
    setOperation('waiting');
    setMainTab('targets');
    setMessage('');
    }catch(ex){setError((ex as Error).message);setOperation('error');}
    finally{locked.current=false;setSaving(false);}
  };

  const steps=[
    {id:'body',label:'Body',icon:User},
    {id:'activity',label:'Activity',icon:Activity},
    {id:'goal',label:'Goal',icon:Target},
    {id:'macros',label:'Macros',icon:PieChart}
  ] as const;

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
    <TargetFigures result={proposal.result}/>
    {proposal.result.goalProgress&&<GoalSummary progress={proposal.result.goalProgress}/>}
    {proposal.holdReason&&<p className="notice">{proposal.holdReason}</p>}
    {!proposal.canAccept&&!proposal.holdReason&&<p className="notice">{proposal.result.explanation}</p>}
    </>:<h2>{message?'Active plan':'Review plan'}</h2>}
    {(busy||operation==='waiting')&&<CoachWait label={operationLabel} active={operation!=='waiting'||(online&&!queueError&&!store.error)}/>}
    {operation==='error'&&!proposal&&<Button onClick={()=>void loadProposal()} disabled={!online||pending||changed}>Retry calculation</Button>}
    {operation==='refresh-error'&&<Button onClick={()=>void retryRefresh()}>Retry loading targets</Button>}
    <div className="coach-review-actions"><Button variant="tertiary" disabled={!!acceptance.current||operation==='saving'||operation==='accepting'||operation==='updating'||operation==='refreshing'} onClick={()=>openPlan('macros')}><ArrowLeft size={16}/>Back to edit</Button></div>
  </CoachLayout></section>:null;

  const targetsTab=<>
    <GoalReachedBanner progress={goalProgress} store={store} onChooseGoal={()=>openPlan('goal')}
      onComplete={trigger=>{setCheckInRestore(trigger);setCheckInOpen(true);}}/>
    <CheckInCard store={store} onReview={trigger=>{setCheckInRestore(trigger);setCheckInOpen(true);}}/>
    {acceptedPlan&&<section className="panel">
      <div className="section-heading">
        <div><h2>Active targets</h2></div>
        <div className="actions">
          <Button variant="secondary" size="md" disabled={busy||!!acceptance.current} onClick={()=>openPlan()}><Sliders size={16}/>Edit plan</Button>
          <Button variant="primary" size="md" disabled={busy||pending||!online||changed||!!acceptance.current} onClick={()=>void loadProposal()}>
            Check in
          </Button>
        </div>
      </div>
      <TargetFigures result={acceptedPlan}/>
      {goalProgress&&<GoalSummary progress={goalProgress}/>}
    </section>}
    {proposalPanel}
    <section className="panel">
      <div className="section-heading">
        <div><h2>Strategy</h2></div>
      </div>
      <dl className="strategy-figures">
        <div><dt>Goal</dt><dd>{goalLabel(profile.goal||'maintain')}</dd></div>
        <div><dt>Pace</dt><dd>{!profile.goal||profile.goal==='maintain'?'—':`${Math.abs(profile.goalRatePercent??(profile.goal==='lose'?-0.5:0.15))}% bodyweight/week`}</dd></div>
        <div><dt>Tracking</dt><dd>{profile.phaseMode==='duration'?`${profile.durationWeeks} weeks`:profile.phaseMode==='weight'?`${profile.targetWeightKg} kg`:'Ongoing'}</dd></div>
        <div><dt>Macros</dt><dd>{presetLabel(storedSplit(profile)?profile.macroPreset??'custom':'auto')}</dd></div>
        <div><dt>Body</dt><dd>{profile.weightKg} kg · {profile.heightCm} cm</dd></div>
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

    <CoachStepper active={step}>
      {steps.map((s,i)=>{
        const isCurrent=step===s.id;
        const Icon=s.icon;
        if(isInitialSetup)return <div key={s.id} className={`step-pill step-indicator ${isCurrent?'active':''}`} aria-current={isCurrent?'step':undefined}>
          <Icon size={16}/><span>{i+1}. {s.label}</span>
        </div>;
        return <Button key={s.id} type="button" variant={isCurrent?'primary':'secondary'} className={`step-pill ${isCurrent?'active':''}`} onClick={()=>{if(stepOrder.indexOf(s.id)<stepOrder.indexOf(step)||validateFields(stage.current))setStep(s.id);}}>
          <Icon size={16}/><span>{i+1}. {s.label}</span>
        </Button>;
      })}
    </CoachStepper>

    <Form onSubmit={e=>{e.preventDefault();if(step==='macros')void submitProfile();else setStep(stepOrder[stepOrder.indexOf(step)+1]);}}>
      <CoachLayout><div ref={stage} className="coach-step-stage" data-step={step}>
      <h3 tabIndex={-1} data-step-heading className="coach-step-heading">{steps.find(s=>s.id===step)!.label}</h3>
      {step==='body'&&<div className="step-content">
        <div className="form-grid">
          <DatePicker id="coach-date-of-birth" name="dateOfBirth" validate={()=>derivedAge!=null&&(derivedAge<13||derivedAge>120)?'Enter a date of birth for an age from 13 to 120.':undefined} label="Date of birth" required min="1900-01-01" max={current} value={profile.dateOfBirth??''} onChange={v=>set('dateOfBirth',v)} hint={derivedAge!=null?`Age ${derivedAge}`:undefined}/>
          <Field id="coach-height" name="heightCm" label="Height (cm)" type="number" required min="80" max="250" step="0.1" value={profile.heightCm||''} onChange={e=>set('heightCm',Number(e.target.value))}/>
          <Field id="coach-weight" name="weightKg" label="Starting weight (kg)" type="number" required min="20" max="400" step="0.1" value={profile.weightKg||''} onChange={e=>set('weightKg',Number(e.target.value))}/>
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
        <Field id="coach-maintenance" name="maintenance" label="Known maintenance calories (optional)" type="number" min="1000" max="7000" value={profile.maintenance??''} placeholder="Use the equation" onChange={e=>set('maintenance',e.target.value?Number(e.target.value):null)}/>
        <div className="checks">
          <label htmlFor="coach-resistance-training">
            <input id="coach-resistance-training" name="resistanceTraining" type="checkbox" checked={profile.resistanceTraining} onChange={e=>set('resistanceTraining',e.target.checked)}/>
            Resistance training
          </label>
          {([['pregnancyOrBreastfeeding','Pregnant or breastfeeding'],['medicalNutrition','Medically managed nutrition']] as const).map(([key,label])=><label key={key} htmlFor={`coach-${key}`}>
            <input id={`coach-${key}`} name={key} type="checkbox" checked={profile[key]} onChange={e=>set(key,e.target.checked)}/>{label}
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
        <GoalSetup profile={profile} set={set} acceptedExpenditure={acceptedPlan?.expenditure}/>
        <div className="step-actions">
          <Button type="button" size="md" variant="secondary" onClick={()=>setStep('activity')}><ArrowLeft size={16}/> Back</Button>
          <Button type="button" size="md" variant="primary" onClick={()=>{if(validateFields(stage.current))setStep('macros');}}>
            Next: Macros <ArrowRight size={16}/>
          </Button>
        </div>
      </div>}

      {step==='macros'&&<div className="step-content">
        <MacroSetup
          calories={live.target}
          split={split}
          onChange={next=>setSplit(next,'custom')}
          onPreset={(id,next)=>setSplit(next,id==='auto'?null:id)}
        />
        <WeeklyProgramSetup budget={live.weeklyCalories} values={weeklyValues} onChange={values=>{
          setWeeklyDraft(values);
          set('distributionShares',normaliseDistribution(values));
        }}/>
        <dl className="strategy-figures">
          <div><dt>Resting</dt><dd>{number(live.resting)} kcal</dd></div>
          <div><dt>Maintenance</dt><dd>{number(live.expenditure)} kcal</dd></div>
          <div><dt>Daily target</dt><dd>{number(live.target)} kcal</dd></div>
        </dl>
        <div className="step-actions">
          <Button type="button" size="md" variant="secondary" onClick={()=>setStep('goal')}><ArrowLeft size={16}/> Back</Button>
          <Button variant="primary" size="md" type="submit" disabled={busy}>
            {operation==='saving'?'Saving on this device…':isInitialSetup?'Create my starting estimate':'Save profile'}
          </Button>
        </div>
      </div>}
      </div></CoachLayout>
    </Form>
  </section>;

  const historyTab=<section className="panel">
    <h2>Accepted plans</h2>
    {plans.length===0?<p>No accepted plans yet.</p>:<dl className="plan-list">
      {plans.map(plan=>{
        const result=JSON.parse(plan.resultJson) as CoachResult;
        return <div key={plan.id}>
          <dt>{plan.date}</dt>
          <dd>{number(result.calories)} kcal · {number(result.protein)} / {number(result.carbs)} / {number(result.fat)} g</dd>
        </div>;
      })}
    </dl>}
  </section>;

  return <>
    <header className="page-heading">
      <div><h1>Coach</h1></div>
    </header>

    {!isInitialSetup&&<SegmentedControl<MainTab> className="section-segments" label="Coach sections" value={mainTab}
      options={[{value:'targets',label:'Targets'},{value:'plan',label:'Plan',disabled:operation==='accepting'||operation==='updating'||operation==='refreshing'||!!acceptance.current},{value:'history',label:'History'}]}
      onChange={value=>{if(value==='plan')openPlan(step);else {setMessage('');setMainTab(value);}}}/>}

    {message&&<p className="status-banner coach-success" role="status"><Check size={18} aria-hidden="true"/>{message}</p>}
    {error&&<p className="error" role="alert">{error}</p>}

    <div key={isInitialSetup?(review?'review':'setup'):mainTab} className="coach-tab-scene">
    {isInitialSetup?<>{review?proposalPanel:planTab}</>
      :mainTab==='targets'?targetsTab
      :mainTab==='plan'?planTab
      :historyTab}</div>
    <CheckInDialog open={checkInOpen} store={store} restoreFocus={checkInRestore} onClose={()=>setCheckInOpen(false)}/>
  </>;
}

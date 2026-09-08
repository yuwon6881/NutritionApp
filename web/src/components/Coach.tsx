import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Sparkles,User,Activity,Target,Sliders} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {Profile,ProfileDraft,CoachResult} from '../types';
import {api} from '../lib/api';
import {number} from '../lib/format';
import {profilesEqual} from '../lib/profile';
import {calculateLivePace} from '../lib/coachCalc';
import {Button} from './ui/Button';
import {Field,SelectField} from './ui/Field';
import {Methodology} from './Methodology';
import {GoalSetup} from './GoalSetup';
import {GoalSummary} from './GoalSummary';

const defaults:ProfileDraft={
  age:0,
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
  energyAdjustmentPercent:0
};

type Preview={revision:number;result:CoachResult;canAccept:boolean;holdReason:string|null};
type StepKey='body'|'activity'|'goal'|'review';
type MainTab='checkin'|'profile'|'history';

export function Coach({store,onboarding=false}:{store:Nourish;onboarding?:boolean}){
  const [profile,setProfile]=useState<ProfileDraft>(store.state!.profile??defaults);
  const [preview,setPreview]=useState<Preview>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [awaitingEstimate,setAwaitingEstimate]=useState(false);
  const [step,setStep]=useState<StepKey>('body');

  const hasPlan=store.state!.plans.some(p=>!p.deleted);
  const isInitialSetup=onboarding||!hasPlan;
  const [mainTab,setMainTab]=useState<MainTab>(isInitialSetup?'profile':'checkin');

  const accepted=store.state!.plans.find(p=>!p.deleted&&p.profileRevision===store.state!.profileRevision);
  const acceptedPlan:CoachResult|undefined=accepted?JSON.parse(accepted.resultJson):undefined;

  const set=(key:keyof Profile,value:unknown)=>{
    setProfile(p=>({
      ...p,
      [key]:value,
      ...(key==='goal'?{
        energyAdjustmentPercent:value==='lose'?15:value==='gain'?5:0,
        ...(value==='maintain'?{phaseMode:'open' as const}:{})
      }:{})
    }));
    setPreview(undefined);
  };

  const pending=store.local!.queue.length>0;
  const changed=!profilesEqual(profile,store.state!.profile);

  const action=async(fn:()=>Promise<void>)=>{
    setBusy(true);
    setError('');
    try{await fn();}
    catch(ex){setError((ex as Error).message);}
    finally{setBusy(false);}
  };

  useEffect(()=>{
    if(awaitingEstimate&&!pending&&!changed&&navigator.onLine){
      setAwaitingEstimate(false);
      void action(async()=>setPreview(await api<Preview>('/coach/preview')));
    }
  },[awaitingEstimate,pending,changed]);

  const live=calculateLivePace(profile,undefined,acceptedPlan?.expenditure);

  const submitProfile=async()=>{
    await store.mutate({
      kind:'profile',
      recordId:store.state!.id,
      expectedRevision:store.state!.profileRevision,
      data:profile,
      delete:false
    });
    setPreview(undefined);
    if(isInitialSetup)setAwaitingEstimate(true);
    else setMainTab('checkin');
    setMessage('Profile saved on this device.');
  };

  const steps=[
    {id:'body',label:'Body',icon:User},
    {id:'activity',label:'Activity',icon:Activity},
    {id:'goal',label:'Goal & Pace',icon:Target},
    {id:'review',label:'Review',icon:Sliders}
  ] as const;

  return <>
    <header className="page-heading">
      <div>
        <p className="eyebrow">SMALL CHANGES, GROUNDED IN YOUR DATA</p>
        <h1>{isInitialSetup?"Let's find your starting point":'Your nutrition coach'}</h1>
        <p>{isInitialSetup
          ?'Welcome to Nourish. Follow the guided steps below to estimate your resting metabolism and daily energy targets.'
          :'An adaptive coach that personalizes targets as you log your meals and weight.'}
        </p>
      </div>
    </header>

    {!isInitialSetup&&store.state!.profile&&<div className="tabs coach-nav-tabs" role="group" aria-label="Coach sections">
      <Button variant={mainTab==='checkin'?'primary':'secondary'} onClick={()=>setMainTab('checkin')}>
        <Sparkles size={16}/>Weekly check-in
      </Button>
      <Button variant={mainTab==='profile'?'primary':'secondary'} onClick={()=>setMainTab('profile')}>
        <Sliders size={16}/>Adjust profile & strategy
      </Button>
      <Button variant={mainTab==='history'?'primary':'secondary'} onClick={()=>setMainTab('history')}>
        Plan history & methods
      </Button>
    </div>}

    {(!isInitialSetup&&mainTab==='checkin')&&<section className="panel checkin-panel">
      <div className="section-heading">
        <div>
          <h2>Your configured coach & targets</h2>
          <p>{pending?'Finish syncing your changes before calculating a proposal.':'Active targets calculated from your profile and logging history.'}</p>
        </div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <Button variant="primary" size="md" disabled={busy||pending||changed||!navigator.onLine} onClick={()=>void action(async()=>setPreview(await api<Preview>('/coach/preview')))}>
            <Sparkles size={16}/>{busy?'Working…':'Review my targets'}
          </Button>
          <Button variant="secondary" size="md" onClick={()=>setMainTab('profile')}>
            <Sliders size={16}/>Edit profile & strategy
          </Button>
        </div>
      </div>

      {acceptedPlan&&<div className="active-targets-card">
        <span className="eyebrow">CURRENT ACTIVE TARGETS</span>
        <div className="stats-grid">
          <div>
            <p>Daily energy</p>
            <h2>{number(acceptedPlan.calories)} <span className="unit">kcal</span></h2>
          </div>
          <div>
            <p>Estimated expenditure</p>
            <h2>{number(acceptedPlan.expenditure)} <span className="unit">kcal</span></h2>
          </div>
          <div>
            <p>Protein / carbs / fat</p>
            <strong>{number(acceptedPlan.protein)} / {number(acceptedPlan.carbs)} / {number(acceptedPlan.fat)} g</strong>
          </div>
        </div>
        {acceptedPlan.goalProgress&&<div style={{marginTop:16}}><GoalSummary progress={acceptedPlan.goalProgress}/></div>}
      </div>}

      <div className="card-tint panel" style={{marginTop:18,marginBottom:18}}>
        <span className="eyebrow">CONFIGURED STRATEGY & PROFILE</span>
        <div className="stats-grid" style={{marginBottom:12}}>
          <div>
            <p>Current Goal</p>
            <strong style={{textTransform:'capitalize'}}>{profile.goal==='lose'?'Fat loss':profile.goal==='gain'?'Bulking':'Maintenance'}</strong>
            <p style={{fontSize:'.75rem',marginTop:4}}>{profile.goal==='lose'?`${profile.energyAdjustmentPercent}% calorie deficit`:profile.goal==='gain'?`${profile.energyAdjustmentPercent}% calorie surplus`:'Standard maintenance'}</p>
          </div>
          <div>
            <p>Tracking Mode</p>
            <strong>{profile.phaseMode==='duration'?`Duration · ${profile.durationWeeks} weeks`:profile.phaseMode==='weight'?`Target weight · ${profile.targetWeightKg} kg`:'Ongoing phase'}</strong>
            {profile.phaseStart&&<p style={{fontSize:'.75rem',marginTop:4}}>Started: {profile.phaseStart}</p>}
          </div>
          <div>
            <p>Body Measurements</p>
            <strong>{profile.weightKg} kg · {profile.heightCm} cm</strong>
            <p style={{fontSize:'.75rem',marginTop:4}}>Age {profile.age} · {profile.sex==='female'?'Female eq.':'Male eq.'} · {profile.activity}x act.</p>
          </div>
        </div>
        <Button variant="secondary" size="md" onClick={()=>setMainTab('profile')}>
          <Sliders size={16}/>Edit profile settings
        </Button>
      </div>

      {preview&&<div className="proposal-card">
        <span className="eyebrow">NEW PROPOSAL FOR REVIEW</span>
        <div className="stats-grid">
          <div>
            <p>Proposed calories</p>
            <h2>{number(preview.result.calories)} <span className="unit">kcal</span></h2>
          </div>
          <div>
            <p>Estimated expenditure</p>
            <h2>{number(preview.result.expenditure)} <span className="unit">kcal</span></h2>
          </div>
          <div>
            <p>Protein / carbs / fat</p>
            <strong>{number(preview.result.protein)} / {number(preview.result.carbs)} / {number(preview.result.fat)} g</strong>
          </div>
        </div>
        <p>{preview.result.explanation}</p>
        {preview.result.goalProgress&&<GoalSummary progress={preview.result.goalProgress}/>}
        {preview.holdReason&&<p className="notice">{preview.holdReason}</p>}
        <Button disabled={busy||pending||!preview.canAccept||preview.revision!==store.state!.revision} variant="primary" onClick={()=>void action(async()=>{
          await api('/coach/accept',{id:crypto.randomUUID(),revision:preview.revision});
          await store.refresh();
          setPreview(undefined);
          setMessage('Your reviewed plan is now active.');
        })}>
          Accept this plan
        </Button>
      </div>}

      {message&&<p role="status">{message}</p>}
      {error&&<p className="error" role="alert">{error}</p>}
    </section>}

    {(isInitialSetup||mainTab==='profile')&&<section className="panel guided-coach-panel">
      <div className="wizard-header">
        <div className="section-heading" style={{marginBottom:14}}>
          <div>
            <h2>{isInitialSetup?"Setup your profile":"Adjust your profile & goals"}</h2>
            <p>Guided setup: complete each tab to tailor your nutrition targets.</p>
          </div>
          {!isInitialSetup&&<Button variant="tertiary" size="md" onClick={()=>setMainTab('checkin')}>
            ← Back to summary
          </Button>}
        </div>

        <nav className="guided-stepper" aria-label="Guided coach steps">
          {steps.map((s,i)=>{
            const isCurrent=step===s.id;
            const Icon=s.icon;
            return <Button
              key={s.id}
              type="button"
              variant={isCurrent?'primary':'secondary'}
              className={`step-pill ${isCurrent?'active':''}`}
              onClick={()=>setStep(s.id)}
            >
              <Icon size={16}/>
              <span>{i+1}. {s.label}</span>
            </Button>;
          })}
        </nav>
      </div>

      <form onSubmit={e=>{e.preventDefault();void action(submitProfile);}}>
        {step==='body'&&<div className="step-content">
          <div className="step-intro">
            <h3>Your body & measurements</h3>
            <p>Mifflin–St Jeor uses age, height, weight, and sex equation parameter to calculate resting metabolic rate.</p>
          </div>
          <div className="form-grid">
            <Field label="Age (years)" type="number" required min="1" max="120" value={profile.age||''} onChange={e=>set('age',Number(e.target.value))}/>
            <Field label="Height (cm)" type="number" required min="80" max="250" step="0.1" value={profile.heightCm||''} onChange={e=>set('heightCm',Number(e.target.value))}/>
            <Field label="Starting weight (kg)" type="number" required min="20" max="400" step="0.1" value={profile.weightKg||''} onChange={e=>set('weightKg',Number(e.target.value))}/>
            <SelectField required label="Sex parameter for equation" value={profile.sex} onChange={v=>set('sex',v)}>
              <option value="" disabled>Choose an equation parameter</option>
              <option value="female">Female equation</option>
              <option value="male">Male equation</option>
            </SelectField>
          </div>
          <div className="step-actions">
            <div />
            <Button type="button" size="md" variant="primary" onClick={()=>setStep('activity')}>
              Next: Activity & health <ArrowRight size={16}/>
            </Button>
          </div>
        </div>}

        {step==='activity'&&<div className="step-content">
          <div className="step-intro">
            <h3>Activity & training</h3>
            <p>Sets your baseline expenditure multiplier and recommends protein targets.</p>
          </div>
          <SelectField required label="Usual activity (approximate)" value={profile.activity?String(profile.activity):''} onChange={v=>set('activity',Number(v))}>
            <option value="" disabled>Choose your usual activity</option>
            <option value="1.2">Very little activity · 1.2</option>
            <option value="1.4">Mostly sitting, some walking · 1.4</option>
            <option value="1.6">Moderately active · 1.6</option>
            <option value="1.8">Active most days · 1.8</option>
            <option value="2.0">Very active · 2.0</option>
          </SelectField>

          <div className="checks">
            <label>
              <input type="checkbox" checked={profile.resistanceTraining} onChange={e=>set('resistanceTraining',e.target.checked)}/>
              I do resistance training (increases recommended protein target)
            </label>
          </div>

          <details className="special-checks">
            <summary>Health boundaries & special considerations</summary>
            <div className="checks" style={{marginTop:12}}>
              {([['pregnancyOrBreastfeeding','I am pregnant or breastfeeding'],['medicalNutrition','My nutrition is medically managed']] as const).map(([key,label])=><label key={key}>
                <input type="checkbox" checked={profile[key]} onChange={e=>set(key,e.target.checked)}/>{label}
              </label>)}
            </div>
            <p className="source">Automated targets are held for minors, pregnancy/breastfeeding, or medically managed nutrition.</p>
          </details>

          <div className="step-actions">
            <Button type="button" size="md" variant="secondary" onClick={()=>setStep('body')}>
              <ArrowLeft size={16}/> Back
            </Button>
            <Button type="button" size="md" variant="primary" onClick={()=>setStep('goal')}>
              Next: Goal & pace <ArrowRight size={16}/>
            </Button>
          </div>
        </div>}

        {step==='goal'&&<div className="step-content">
          <div className="step-intro">
            <h3>Your goal & pace</h3>
            <p>Select your direction. The slider shows live calorie estimates as you adjust.</p>
          </div>
          <SelectField required label="Your goal" value={profile.goal} onChange={v=>set('goal',v)}>
            <option value="" disabled>Choose your goal</option>
            <option value="lose">Fat loss</option>
            <option value="maintain">Maintenance</option>
            <option value="gain">Bulking</option>
          </SelectField>

          <GoalSetup profile={profile} set={set} acceptedExpenditure={acceptedPlan?.expenditure}/>

          <div className="step-actions">
            <Button type="button" size="md" variant="secondary" onClick={()=>setStep('activity')}>
              <ArrowLeft size={16}/> Back
            </Button>
            <div style={{display:'flex',gap:'10px'}}>
              {!isInitialSetup&&<Button size="md" variant="secondary" type="submit" disabled={busy}>
                Save profile
              </Button>}
              <Button type="button" size="md" variant={isInitialSetup?'primary':'secondary'} onClick={()=>setStep('review')}>
                Next: Review & finalize <ArrowRight size={16}/>
              </Button>
            </div>
          </div>
        </div>}

        {step==='review'&&<div className="step-content">
          <div className="step-intro">
            <h3>Review your strategy</h3>
            <p>Your estimated energy needs and starting proposal are calculated from your profile.</p>
          </div>

          <div className="stats-grid" style={{marginBottom:20}}>
            <div className="stat-card">
              <p>Resting metabolism</p>
              <h2>{number(live.resting)} <span className="unit">kcal/day</span></h2>
            </div>
            <div className="stat-card">
              <p>Estimated TDEE</p>
              <h2>{number(live.expenditure)} <span className="unit">kcal/day</span></h2>
            </div>
            <div className="stat-card">
              <p>Estimated target</p>
              <h2>{number(live.target)} <span className="unit">kcal/day</span></h2>
            </div>
          </div>

          <details open className="special-checks" style={{marginBottom:20}}>
            <summary>Optional overrides (advanced)</summary>
            <div className="form-grid" style={{marginTop:14}}>
              <Field label="Known maintenance calories (optional)" type="number" min="1000" max="7000" value={profile.maintenance??''} placeholder="Use the starting equation" onChange={e=>set('maintenance',e.target.value?Number(e.target.value):null)}/>
              <Field label="Daily protein override (g, optional)" type="number" min="0" max="800" value={profile.proteinGrams??''} placeholder="Use the coaching default" onChange={e=>set('proteinGrams',e.target.value?Number(e.target.value):null)}/>
            </div>
          </details>

          <div className="step-actions">
            <Button type="button" size="md" variant="secondary" onClick={()=>setStep('goal')}>
              <ArrowLeft size={16}/> Back
            </Button>
            <Button variant="primary" size="md" type="submit" disabled={busy}>
              {isInitialSetup?'Create my starting estimate':'Save profile'}
            </Button>
          </div>
        </div>}
      </form>

      {preview&&<div className="proposal-card" style={{marginTop:24}}>
        <span className="eyebrow">YOUR STARTING PROPOSAL</span>
        <div className="stats-grid">
          <div>
            <p>Daily energy</p>
            <h2>{number(preview.result.calories)} <span className="unit">kcal</span></h2>
          </div>
          <div>
            <p>Estimated expenditure</p>
            <h2>{number(preview.result.expenditure)} <span className="unit">kcal</span></h2>
          </div>
          <div>
            <p>Protein / carbs / fat</p>
            <strong>{number(preview.result.protein)} / {number(preview.result.carbs)} / {number(preview.result.fat)} g</strong>
          </div>
        </div>
        <p>{preview.result.explanation}</p>
        {preview.holdReason&&<p className="notice">{preview.holdReason}</p>}
        <Button disabled={busy||pending||!preview.canAccept||preview.revision!==store.state!.revision} variant="primary" onClick={()=>void action(async()=>{
          await api('/coach/accept',{id:crypto.randomUUID(),revision:preview.revision});
          await store.refresh();
          setPreview(undefined);
          setMessage('Your reviewed plan is now active.');
        })}>
          Accept this plan
        </Button>
      </div>}

      {message&&<p role="status">{message}</p>}
      {error&&<p className="error" role="alert">{error}</p>}
    </section>}

    {(!isInitialSetup&&mainTab==='history')&&<>
      {store.state!.plans.length>0&&<section className="panel">
        <h2>Plans you’ve accepted</h2>
        {store.state!.plans.map(plan=>{
          const result=JSON.parse(plan.resultJson) as CoachResult;
          return <details className="plan-history" key={plan.id}>
            <summary>{plan.date} · {number(result.calories)} kcal · v{result.version}</summary>
            <p>{result.explanation}</p>
            <small>Input revision {plan.inputRevision}. Historical plans are preserved when older logs change.</small>
          </details>;
        })}
      </section>}
      <Methodology/>
    </>}
  </>;
}

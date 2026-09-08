import type {ProfileDraft} from '../types';
import {today,number} from '../lib/format';
import {calculateLivePace} from '../lib/coachCalc';
import {Field,SelectField} from './ui/Field';
import {DatePicker} from './ui/DatePicker';

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
  const high=percent>(loss?20:10);
  const low=percent<(loss?10:5);
  const mode=profile.phaseMode??'open';
  const live=calculateLivePace(profile,percent,acceptedExpenditure);

  return <fieldset className="goal-setup"><legend>Your pace and finish line</legend>
    {profile.goal&&profile.goal!=='maintain'&&<>
      <div className="live-calorie-card" aria-live="polite">
        <div className="live-calorie-header">
          <span className="live-calorie-tag">LIVE ESTIMATED TARGET</span>
          <div className="live-calorie-value">
            <strong>{number(live.target)}</strong> <span className="unit">kcal / day</span>
          </div>
        </div>
        <div className="live-calorie-meta">
          <span>Est. maintenance: ~{number(live.expenditure)} kcal</span>
          <span className="live-delta">{loss?'−':'+'}{Math.abs(live.change)} kcal ({percent}%)</span>
          <span className="live-macros">Targets: ~{live.protein}g P · {live.carbs}g C · {live.fat}g F</span>
        </div>
      </div>
      <Field label={loss?'Calorie deficit (%)':'Calorie surplus (%)'} type="range" min="2" max={loss?25:20} step="1" value={percent} aria-valuetext={`${percent}% ${loss?'deficit':'surplus'}`} onChange={e=>set('energyAdjustmentPercent',Number(e.target.value))}/>
      <p aria-live="polite"><strong>{percent}% {loss?'deficit':'surplus'}</strong> · {high?'Not recommended as a starting pace':low?'Gentler pace':'Recommended conservative starting range'}</p>
      <p className={high?'notice':'source'}>{loss?'Recommended starting band: 10–20% below estimated maintenance. Above 20% is more aggressive and may make recovery and lean-mass retention harder.':'Recommended starting band: 5–10% above estimated maintenance. Larger surpluses can add more fat without proportionately more muscle.'} These bands are conservative product guidance informed by research, not universal clinical cutoffs.</p>
      <p className="source">The percentage follows your learned maintenance estimate. The 1,500 kcal floor, 25% deficit ceiling and weekly adjustment limits still apply.</p>
    </>}
    {profile.goal==='maintain'&&<>
      <div className="live-calorie-card" aria-live="polite">
        <div className="live-calorie-header">
          <span className="live-calorie-tag">ESTIMATED MAINTENANCE TARGET</span>
          <div className="live-calorie-value">
            <strong>{number(live.target)}</strong> <span className="unit">kcal / day</span>
          </div>
        </div>
        <p className="live-calorie-meta" style={{margin:0}}>Estimated expenditure: ~{number(live.expenditure)} kcal/day · No intentional deficit or surplus.</p>
      </div>
      <p>Maintenance follows the energy estimate learned from your intake and weight. No intentional deficit or surplus.</p>
    </>}
    <SelectField label="Track my goal by" value={mode} onChange={v=>{set('phaseMode',v);if(v==='duration'&&!profile.durationWeeks)set('durationWeeks',8);set('phaseStart',today(profile.timeZone));set('phaseStartWeightKg',profile.weightKg>0?profile.weightKg:null);}}><option value="open">Ongoing phase</option><option value="duration">Duration</option><option value="weight" disabled={!profile.goal||profile.goal==='maintain'}>Target weight</option></SelectField>
    {mode==='duration'&&<div className="form-grid"><Field label="Phase length (weeks)" required type="number" min="1" max="104" value={profile.durationWeeks??8} onChange={e=>set('durationWeeks',Number(e.target.value))}/><DatePicker label="Phase start date" required max={today(profile.timeZone)} value={profile.phaseStart??today(profile.timeZone)} onChange={v=>set('phaseStart',v)}/></div>}
    {mode==='weight'&&<div className="form-grid"><Field label="Phase starting weight (kg)" required type="number" min="20" max="400" step="0.1" value={(profile.phaseStartWeightKg??profile.weightKg)||''} onChange={e=>set('phaseStartWeightKg',Number(e.target.value))}/><Field label="Target weight (kg)" required type="number" min="20" max="400" step="0.1" value={profile.targetWeightKg??''} onChange={e=>set('targetWeightKg',e.target.value?Number(e.target.value):null)}/></div>}
    <p className="source">Target-weight progress uses smoothed weight. After enough weigh-ins, the finish estimate follows your observed pace; a plateau can remove that estimate. Duration progress tracks elapsed time. Every calorie change still needs your acceptance.</p>
    <details><summary>Research behind the pace guidance</summary><p>Slower weight loss helped preserve lean mass in an <a href="https://pubmed.ncbi.nlm.nih.gov/21558571/" target="_blank" rel="noreferrer">athlete weight-loss trial</a>. A small <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10620361/" target="_blank" rel="noreferrer">surplus study in trained lifters</a> found faster weight gain primarily increased fat gain. These populations do not establish an optimal percentage for everyone.</p></details>
  </fieldset>;
}

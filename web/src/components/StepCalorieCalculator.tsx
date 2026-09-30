import {useId,useMemo,useState} from 'react';
import type {Nourish} from '../useNourish';
import type {CoachResult} from '../types';
import {number,today} from '../lib/format';
import {cleanTrend} from '../lib/weightSignal';
import {displayEnergy,displayHeight,displayWeight,energyLabel,inputEnergy,parseEnergy,unitsFor,weightLabel} from '../lib/units';
import {NET_WALKING_KCAL_PER_KG_KM,shareOfMaintenance,stepsForCalories} from '../lib/stepCalories';
import {Field} from './ui/Field';

const KM_PER_MILE=1.609344;
const DEFAULT_TARGET_KCAL=300;

/**
 * Turns an energy target into the extra walking steps it takes, from the user's own trend weight,
 * height, and sex. Shown inside the Dashboard steps card and on the Activity tab; it only
 * informs and never changes targets or coaching.
 */
export function StepCalorieCalculator({store,variant}:{store:Nourish;variant:'inline'|'panel'}){
  const state=store.state!;
  const profile=state.profile;
  const units=unitsFor(state.settings);
  const date=today(profile?.timeZone);
  const headingId=useId();
  const trend=useMemo(()=>cleanTrend([...(state.weightTrendSeed??[]),...state.weights.filter(w=>!w.deleted)],date).at(-1),[state.weightTrendSeed,state.weights,date]);
  const [text,setText]=useState(()=>inputEnergy(DEFAULT_TARGET_KCAL,units.energy));

  const accepted=state.plans.find(plan=>!plan.deleted);
  const coachMaintenance=accepted?(JSON.parse(accepted.resultJson) as CoachResult).expenditure:null;
  const maintenance=coachMaintenance??profile?.maintenance??null;
  const weightKg=trend?.kg??profile?.weightKg??null;
  const targetKcal=parseEnergy(text,units.energy);
  const estimate=stepsForCalories({targetKcal,weightKg,heightCm:profile?.heightCm,sex:profile?.sex});
  const share=shareOfMaintenance(targetKcal,maintenance);
  const imperial=units.height==='ft-in';
  const distance=estimate?`${number(imperial?estimate.distanceKm/KM_PER_MILE:estimate.distanceKm,1)} ${imperial?'mi':'km'}`:'';

  const missing=!(targetKcal>0)?'Enter the energy you want to burn.'
    :weightKg==null?'Log a weigh-in to estimate steps.'
      :!(profile?.heightCm&&profile.heightCm>0)?'Add your height in Settings to estimate steps.':null;

  const body=<div className="step-calculator-body">
    <Field name="step-calculator-energy" label={`Energy to burn (${energyLabel(units.energy)})`} type="number" min="1" step="10"
      value={text} onChange={event=>setText(event.target.value)}/>
    <div className="step-calculator-result" role="status" aria-live="polite">
      {estimate?<>
        <p className="step-calculator-value"><span className="tabular-num">{number(estimate.steps)}</span> <span className="unit">extra steps</span></p>
        <p className="source">
          About {distance} · {number(estimate.minutes)} min of steady walking
          {share!=null&&` · ${number(share*100)}% of your ${displayEnergy(maintenance,units.energy)} ${energyLabel(units.energy)} maintenance`}
        </p>
      </>:<p className="source">{missing}</p>}
    </div>
    {estimate&&<p className="source step-calculator-basis">
      These are on top of your usual day, which your maintenance already counts. Based on {displayWeight(weightKg,units.weight,1)} {weightLabel(units.weight)} {trend?'trend weight':'profile weight'},
      {' '}{displayHeight(profile?.heightCm,units.height)} height, and a {number(estimate.stepLengthM,2)} m step; flat walking burns about
      {' '}{NET_WALKING_KCAL_PER_KG_KM} kcal per kg per km above resting ({number(estimate.kcalPerThousandSteps)} kcal per 1,000 steps for you). Hills, pace, and carrying load change it.
    </p>}
  </div>;

  if(variant==='inline')return <details className="step-calculator step-calculator-inline">
    <summary>Steps to burn a target</summary>
    {body}
  </details>;
  return <section className="panel step-calculator step-calculator-panel" aria-labelledby={headingId}>
    <p className="eyebrow" id={headingId}>STEPS FOR AN ENERGY TARGET</p>
    {body}
  </section>;
}

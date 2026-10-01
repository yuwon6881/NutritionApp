import {useId,useMemo,useState} from 'react';
import {Calculator} from 'lucide-react';
import type {Nourish} from '../useNourish';
import type {CoachResult} from '../types';
import {number,today} from '../lib/format';
import {cleanTrend} from '../lib/weightSignal';
import {displayHeight,displayWeight,energyLabel,parseEnergy,unitsFor,weightLabel} from '../lib/units';
import {shareOfMaintenance,stepsForCalories} from '../lib/stepCalories';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {Modal} from './ui/Modal';

const KM_PER_MILE=1.609344;

/**
 * Turns an energy target into the extra walking steps it takes, from the user's own trend weight,
 * height, and sex. Opened from a button in the Dashboard steps card and on the Activity tab; it only
 * informs and never changes targets or coaching.
 */
export function StepCalorieCalculator({store,variant}:{store:Nourish;variant:'inline'|'panel'}){
  const state=store.state!;
  const profile=state.profile;
  const units=unitsFor(state.settings);
  const date=today(profile?.timeZone);
  const headingId=useId();
  const trend=useMemo(()=>cleanTrend([...(state.weightTrendSeed??[]),...state.weights.filter(w=>!w.deleted)],date).at(-1),[state.weightTrendSeed,state.weights,date]);
  const [open,setOpen]=useState(false);
  const [text,setText]=useState('');

  const accepted=state.plans.find(plan=>!plan.deleted);
  const coachMaintenance=accepted?(JSON.parse(accepted.resultJson) as CoachResult).expenditure:null;
  const maintenance=coachMaintenance??profile?.maintenance??null;
  const weightKg=trend?.kg??profile?.weightKg??null;
  const targetKcal=parseEnergy(text,units.energy);
  const estimate=stepsForCalories({targetKcal,weightKg,heightCm:profile?.heightCm,sex:profile?.sex});
  const share=shareOfMaintenance(targetKcal,maintenance);
  const imperial=units.height==='ft-in';
  const distance=estimate?`${number(imperial?estimate.distanceKm/KM_PER_MILE:estimate.distanceKm,1)} ${imperial?'mi':'km'}`:'';

  // An empty field is the starting state, not an error.
  const missing=text.trim()===''||!(targetKcal>0)?null
    :weightKg==null?'Log a weigh-in to estimate steps.'
      :!(profile?.heightCm&&profile.heightCm>0)?'Add your height in Settings to estimate steps.':null;

  const opener=variant==='inline'
    ?<Button variant="tertiary" className="step-calculator-open" onClick={()=>setOpen(true)}><Calculator size={16} aria-hidden="true"/>Steps calculator</Button>
    :<section className="panel step-calculator-panel" aria-labelledby={headingId}>
      <div className="step-calculator-copy">
        <p className="eyebrow" id={headingId}>STEPS CALCULATOR</p>
        <p className="source">Find the extra walking that burns a calorie target, from your own weight and height.</p>
      </div>
      <Button variant="secondary" className="step-calculator-action" onClick={()=>setOpen(true)}><Calculator size={16} aria-hidden="true"/>Steps for an energy target</Button>
    </section>;

  return <>
    {opener}
    <Modal open={open} onClose={()=>setOpen(false)} title="Steps calculator" width="sm">
      <div className="step-calculator-body">
        <Field data-modal-autofocus name="step-calculator-energy" label={`Energy to burn (${energyLabel(units.energy)})`} type="number" min="1" step="10"
          value={text} onChange={event=>setText(event.target.value)}/>
        <div className="step-calculator-result" role="status" aria-live="polite">
          {estimate?<>
            <p className="step-calculator-value"><span className="tabular-num">{number(estimate.steps)}</span> <span className="unit">extra steps</span></p>
            <p className="source">
              {distance} · {number(estimate.minutes)} min walking
              {share!=null&&` · ${number(share*100)}% of maintenance`}
            </p>
          </>:missing&&<p className="source">{missing}</p>}
        </div>
        {estimate&&<p className="source step-calculator-basis">
          On top of your usual day. Uses {displayWeight(weightKg,units.weight,1)} {weightLabel(units.weight)} {trend?'trend':'profile'} weight,
          {' '}{displayHeight(profile?.heightCm,units.height)} height, and a {number(estimate.stepLengthM,2)} m step. Hills and pace change it.
        </p>}
      </div>
    </Modal>
  </>;
}

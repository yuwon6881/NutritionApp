import type {Profile} from '../types';

/**
 * Extra energy walking costs above resting: the ACSM walking equation's horizontal term
 * (0.1 mL O2 per kg per metre) at about 5 kcal per litre of oxygen. It barely changes with
 * ordinary walking pace, so pace is not asked for.
 */
export const NET_WALKING_KCAL_PER_KG_KM=0.5;
/** Step length as a share of height (commonly used anthropometric ratios). */
const STEP_LENGTH_RATIO:Record<Profile['sex'],number>={male:0.415,female:0.413};
/** A steady walk is roughly 100 steps a minute; used only to express the steps as time. */
export const WALKING_STEPS_PER_MINUTE=100;

export type StepEstimateInput={targetKcal:number;weightKg:number|null|undefined;heightCm:number|null|undefined;sex:Profile['sex']|null|undefined};
export type StepEstimate={steps:number;stepLengthM:number;distanceKm:number;minutes:number;kcalPerThousandSteps:number};

/**
 * Steps needed to burn a target amount of extra energy by walking on flat ground. Returns null
 * when weight or height is unknown: the estimate depends on both and is never guessed.
 */
export function stepsForCalories({targetKcal,weightKg,heightCm,sex}:StepEstimateInput):StepEstimate|null{
  if(!Number.isFinite(targetKcal)||targetKcal<=0)return null;
  if(weightKg==null||!(weightKg>0)||heightCm==null||!(heightCm>0))return null;
  const ratio=sex?STEP_LENGTH_RATIO[sex]:(STEP_LENGTH_RATIO.male+STEP_LENGTH_RATIO.female)/2;
  const stepLengthM=heightCm/100*ratio;
  const kcalPerKm=NET_WALKING_KCAL_PER_KG_KM*weightKg;
  const distanceKm=targetKcal/kcalPerKm;
  // Nearest ten: the method is an estimate, and single steps would suggest false precision.
  const steps=Math.max(10,Math.round(distanceKm*1000/stepLengthM/10)*10);
  return {
    steps,
    stepLengthM,
    distanceKm,
    minutes:Math.max(1,Math.round(steps/WALKING_STEPS_PER_MINUTE)),
    kcalPerThousandSteps:kcalPerKm*stepLengthM,
  };
}

/** The target as a share of estimated maintenance, or null when maintenance is unknown. */
export function shareOfMaintenance(targetKcal:number,maintenanceKcal:number|null|undefined):number|null{
  if(maintenanceKcal==null||!(maintenanceKcal>0)||!(targetKcal>0))return null;
  return targetKcal/maintenanceKcal;
}

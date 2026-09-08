import type {ProfileDraft} from '../types';

export function calculateResting(p:Pick<ProfileDraft,'age'|'heightCm'|'weightKg'|'sex'>):number{
  if(!p.age||!p.heightCm||!p.weightKg||!p.sex)return 0;
  return 10*p.weightKg+6.25*p.heightCm-5*p.age+(p.sex==='male'?5:-161);
}

export function estimateExpenditure(p:ProfileDraft,acceptedExpenditure?:number|null):number{
  if(acceptedExpenditure!=null&&acceptedExpenditure>0)return acceptedExpenditure;
  if(p.maintenance!=null&&p.maintenance>0)return p.maintenance;
  const resting=calculateResting(p);
  const activity=p.activity>0?p.activity:1.2;
  return resting>0?resting*activity:0;
}

export interface LivePaceResult{
  resting:number;
  expenditure:number;
  change:number;
  target:number;
  safetyFloor:number;
  protein:number;
  fat:number;
  carbs:number;
}

export function calculateLivePace(
  p:ProfileDraft,
  percentOverride?:number,
  acceptedExpenditure?:number|null
):LivePaceResult{
  const resting=calculateResting(p);
  const expenditure=estimateExpenditure(p,acceptedExpenditure);
  const goal=p.goal||'maintain';
  const percent=percentOverride??p.energyAdjustmentPercent??(goal==='lose'?15:goal==='gain'?5:0);

  const change=goal==='lose'
    ?-expenditure*percent/100
    :goal==='gain'
      ?expenditure*percent/100
      :0;

  let target=expenditure>0?Math.round((expenditure+change)/25)*25:2000;
  const safetyFloor=expenditure>0?Math.ceil(Math.max(1500,expenditure*0.75)/25)*25:1500;
  target=Math.max(target,safetyFloor);

  const effectiveGoal=goal;
  const protein=p.proteinGrams??(p.weightKg>0?Math.round(p.weightKg*(p.resistanceTraining&&effectiveGoal==='lose'?2:1.6)):120);
  const fat=Math.round((target*0.3/9)*10)/10;
  const carbs=Math.max(0,Math.round(((target-protein*4-fat*9)/4)*10)/10);

  return {
    resting:Math.round(resting),
    expenditure:Math.round(expenditure),
    change:Math.round(change),
    target,
    safetyFloor,
    protein,
    fat,
    carbs
  };
}

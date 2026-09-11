import type {CoachResult} from '../types';

export const mondayIndex=(date:string):number=>{
  const day=new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day+6)%7;
};

export function normaliseDistribution(shares?:readonly number[]|null):number[]|null{
  if(!shares||shares.length!==7||shares.some(value=>!Number.isFinite(value)||value<0))return null;
  const total=shares.reduce((sum,value)=>sum+value,0);
  return total>0?shares.map(value=>value/total*100):null;
}

export function equalDistribution():number[]{return Array.from({length:7},()=>100/7);}

export function allocateWeeklyCalories(weeklyCalories:number,shares?:readonly number[]|null):number[]{
  const budget=Math.round(weeklyCalories);
  const normalised=normaliseDistribution(shares)??equalDistribution();
  const raw=normalised.map(share=>budget*share/100);
  const result=raw.map(Math.floor);
  let remainder=budget-result.reduce((sum,value)=>sum+value,0);
  [...raw.keys()]
    .sort((left,right)=>(raw[right]-result[right])-(raw[left]-result[left])||left-right)
    .slice(0,remainder)
    .forEach(index=>{result[index]+=1;});
  return result;
}

export function dailyCalories(result:Pick<CoachResult,'calories'|'weeklyCalories'|'dailyCalories'>,date:string):number|null{
  if(result.dailyCalories?.length===7)return result.dailyCalories[mondayIndex(date)]??null;
  return result.calories??null;
}

export function weeklyCalories(result:Pick<CoachResult,'calories'|'weeklyCalories'|'dailyCalories'>):number|null{
  if(result.weeklyCalories!=null)return result.weeklyCalories;
  if(result.dailyCalories?.length===7)return result.dailyCalories.reduce((sum,value)=>sum+value,0);
  return result.calories==null?null:result.calories*7;
}

export function scaledMacros(result:Pick<CoachResult,'calories'|'protein'|'carbs'|'fat'|'proteinFixed'>,calories:number|null){
  if(calories==null||result.calories==null||result.calories<=0)return {protein:null,carbs:null,fat:null};
  if(result.proteinFixed&&result.protein!=null&&result.fat!=null&&result.carbs!=null){
    // Hold protein constant; redistribute remaining calories across fat and carbs
    // in the same ratio the server used (fat 30% of target, carbs fill the rest).
    const proteinCal=result.protein*4;
    const remaining=Math.max(calories-proteinCal,0);
    const refRemaining=Math.max(result.calories-proteinCal,0);
    const ratio=refRemaining>0?remaining/refRemaining:0;
    return {
      protein:result.protein,
      fat:Math.round(result.fat*ratio*10)/10,
      carbs:Math.round(result.carbs*ratio*10)/10,
    };
  }
  const scale=calories/result.calories;
  return {
    protein:result.protein==null?null:Math.round(result.protein*scale*10)/10,
    carbs:result.carbs==null?null:Math.round(result.carbs*scale*10)/10,
    fat:result.fat==null?null:Math.round(result.fat*scale*10)/10,
  };
}

export function targetsForDate(result:CoachResult|undefined,date:string){
  const calories=result?dailyCalories(result,date):null;
  return {calories,...scaledMacros(result??{calories:null,protein:null,carbs:null,fat:null},calories)};
}

/**
 * Moving one day's calorie budget redistributes the difference among the remaining unlocked days.
 * Locked days stay fixed. Budget is strictly conserved to the single whole calorie.
 */
export function adjustWeeklyCalories(
  values: readonly number[],
  budget: number,
  targetIndex: number,
  requested: number,
  locked: readonly boolean[] = []
): number[] {
  if (values.length !== 7 || targetIndex < 0 || targetIndex >= 7) return [...values];
  const targetBudget = Math.round(budget);
  if (locked[targetIndex]) return [...values];

  const unlockedOthers: number[] = [];
  let lockedSum = 0;
  for (let i = 0; i < 7; i++) {
    if (i === targetIndex) continue;
    if (locked[i]) {
      lockedSum += values[i];
    } else {
      unlockedOthers.push(i);
    }
  }

  if (unlockedOthers.length === 0) {
    const result = [...values];
    result[targetIndex] = Math.max(0, targetBudget - lockedSum);
    return result;
  }

  const availableBudget = Math.max(0, targetBudget - lockedSum);
  const clampedTarget = Math.min(Math.max(0, Math.round(requested)), availableBudget);
  const remainingBudget = availableBudget - clampedTarget;

  const currentOthersSum = unlockedOthers.reduce((sum, i) => sum + Math.max(0, values[i]), 0);
  const raw = unlockedOthers.map(i => {
    const share = currentOthersSum > 0 ? Math.max(0, values[i]) / currentOthersSum : 1 / unlockedOthers.length;
    return remainingBudget * share;
  });
  const resultValues = raw.map(Math.floor);
  let remainder = remainingBudget - resultValues.reduce((sum, val) => sum + val, 0);
  const sorted = [...unlockedOthers.keys()].sort((a, b) => (raw[b] - resultValues[b]) - (raw[a] - resultValues[a]) || a - b);
  for (let k = 0; k < remainder; k++) {
    resultValues[sorted[k]] += 1;
  }

  const next = [...values];
  next[targetIndex] = clampedTarget;
  unlockedOthers.forEach((idx, k) => {
    next[idx] = resultValues[k];
  });

  return next;
}


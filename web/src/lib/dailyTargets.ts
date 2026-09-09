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

export function scaledMacros(result:Pick<CoachResult,'calories'|'protein'|'carbs'|'fat'>,calories:number|null){
  if(calories==null||result.calories==null||result.calories<=0)return {protein:null,carbs:null,fat:null};
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

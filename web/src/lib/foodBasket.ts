import type {AiFood,Entry,Nutrients} from '../types';

export interface BasketLine extends Nutrients {
  key:string;
  quantity:number;
  unit:'g'|'serving';
}

export function lineKey(name:string,source:string):string{
  return `${source}|${name.trim().toLowerCase()}`;
}

export function lineFromPer100(item:Nutrients&{name:string;source:string}):BasketLine{
  return {
    key:lineKey(item.name,item.source),
    name:item.name,
    quantity:100,
    unit:'g',
    calories:item.calories,
    protein:item.protein,
    carbs:item.carbs,
    fat:item.fat,
    fiber:item.fiber,
    source:item.source,
  };
}

export function lineFromAi(food:AiFood,source='AI estimate · reviewed'):BasketLine{
  return {
    key:lineKey(food.name,source),
    name:food.name,
    quantity:food.quantity,
    unit:food.unit,
    calories:food.calories,
    protein:food.protein,
    carbs:food.carbs,
    fat:food.fat,
    fiber:food.fiber,
    source,
  };
}

export interface NutrientTotal {
  value:number|null;
  partial:boolean;
  known:number;
  total:number;
}

export interface BasketTotals {
  calories:number;
  count:number;
  protein:NutrientTotal;
  carbs:NutrientTotal;
  fat:NutrientTotal;
  fiber:NutrientTotal;
}

export function basketTotals(lines:BasketLine[]):BasketTotals{
  const count=lines.length;
  const calories=lines.reduce((sum,line)=>sum+(line.calories||0),0);

  const calcNutrient=(key:'protein'|'carbs'|'fat'|'fiber'):NutrientTotal=>{
    const knownLines=lines.filter(l=>l[key]!=null);
    const known=knownLines.length;
    const value=known>0?knownLines.reduce((sum,l)=>sum+l[key]!,0):null;
    const partial=known>0&&known<count;
    return {value,partial,known,total:count};
  };

  return {
    calories,
    count,
    protein:calcNutrient('protein'),
    carbs:calcNutrient('carbs'),
    fat:calcNutrient('fat'),
    fiber:calcNutrient('fiber'),
  };
}

export function basketEntries(
  lines:BasketLine[],
  stamp:{date:string;time:string|null;meal:string}
):Omit<Entry,'id'|'revision'|'deleted'>[]{
  return lines.map(({key:_,...line})=>({
    ...line,
    ...stamp,
  }));
}

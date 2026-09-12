import type {AiFood,Entry,Nutrients,Portion} from '../types';
import {rescaleNutrients} from './nutrients';
import {parsePortions} from './portions';

export interface BasketLine extends Nutrients {
  key:string;
  quantity:number;
  unit:'g'|'serving';
  portionLabel:string|null;
  portionGrams:number|null;
  portions:Portion[];
}

export function lineKey(name:string,source:string):string{
  return `${source}|${name.trim().toLowerCase()}`;
}

export function lineFromPer100(item:Nutrients&{name:string;source:string;portions?:Portion[];portionsJson?:string}):BasketLine{
  const portions=parsePortions(item.portions?JSON.stringify(item.portions):item.portionsJson);
  const line:BasketLine={
    key:lineKey(item.name,item.source),
    name:item.name,
    quantity:100,
    unit:'g',
    portionLabel:null,
    portionGrams:null,
    portions,
    calories:item.calories,
    protein:item.protein,
    carbs:item.carbs,
    fat:item.fat,
    fiber:item.fiber,
    source:item.source,
  };
  const portion=portions[0];
  return portion?rescaleNutrients(line,{quantity:1,unit:'serving',portionLabel:portion.label,portionGrams:portion.grams}):line;
}

export function lineFromAi(food:AiFood,source='AI estimate · reviewed'):BasketLine{
  return {
    key:lineKey(food.name,source),
    name:food.name,
    quantity:food.quantity,
    unit:food.unit,
    portionLabel:food.portionLabel??null,
    portionGrams:food.portionGrams??null,
    portions:food.portionLabel&&food.portionGrams!=null?[{label:food.portionLabel,grams:food.portionGrams}]:[],
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
  stamp:{date:string;time:string|null}
):Omit<Entry,'id'|'revision'|'deleted'>[]{
  return lines.map(({key:_,portions:__,...line})=>({
    ...line,
    ...stamp,
  }));
}

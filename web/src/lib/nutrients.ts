import type {Nutrients} from '../types';

export function rescaleNutrients<T extends Nutrients & {quantity:number}>(current:T,newQuantity:unknown):T{
  if(typeof newQuantity==='number'&&!isNaN(newQuantity)&&current.quantity>0&&newQuantity>0){
    const ratio=newQuantity/current.quantity;
    return {
      ...current,
      quantity:newQuantity,
      calories:current.calories*ratio,
      protein:current.protein==null?null:current.protein*ratio,
      fat:current.fat==null?null:current.fat*ratio,
      carbs:current.carbs==null?null:current.carbs*ratio,
      fiber:current.fiber==null?null:current.fiber*ratio,
    };
  }
  return {...current,quantity:(typeof newQuantity==='number'?newQuantity:current.quantity) as T['quantity']};
}

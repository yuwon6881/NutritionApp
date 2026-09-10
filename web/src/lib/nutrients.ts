import {resolveGrams,type PortionBasis} from './portions';

type BasisCarrier={quantity:number;unit:'g'|'serving';portionLabel?:string|null;portionGrams?:number|null};
type NutrientValues={calories:number;protein:number|null;fat:number|null;carbs:number|null;fiber:number|null};
type BasisChange=Partial<PortionBasis>;

function basis(current:BasisCarrier,next:BasisChange|number):PortionBasis{
  if(typeof next==='number')return {quantity:next,unit:current.unit,portionLabel:current.portionLabel??null,portionGrams:current.portionGrams??null};
  return {
    quantity:next.quantity??current.quantity,
    unit:next.unit??current.unit,
    portionLabel:next.portionLabel===undefined?(current.portionLabel??null):next.portionLabel,
    portionGrams:next.portionGrams===undefined?(current.portionGrams??null):next.portionGrams,
  };
}

function applyBasis<T extends BasisCarrier>(current:T,next:BasisChange|number):T{
  const after=basis(current,next);
  return {...current,...after} as T;
}

function scale<T extends NutrientValues>(current:T,ratio:number):T{
    return {
      ...current,
      calories:current.calories*ratio,
      protein:current.protein==null?null:current.protein*ratio,
      fat:current.fat==null?null:current.fat*ratio,
      carbs:current.carbs==null?null:current.carbs*ratio,
      fiber:current.fiber==null?null:current.fiber*ratio,
    } as T;
}

export function rescaleNutrients<T extends NutrientValues & BasisCarrier>(current:T,next:BasisChange|number):T{
  const after=basis(current,next);
  const beforeGrams=resolveGrams(current as PortionBasis);
  const afterGrams=resolveGrams(after);
  const onlyQuantity=typeof next==='number'||Object.keys(next).every(key=>key==='quantity');
  const quantityChanged=after.quantity!==current.quantity;
  const canUseQuantityRatio=onlyQuantity&&quantityChanged&&Number.isFinite(current.quantity)&&current.quantity>0&&Number.isFinite(after.quantity)&&after.quantity>0;

  if (beforeGrams!=null&&afterGrams!=null) return {...scale(current,afterGrams/beforeGrams),...after} as T;
  if (canUseQuantityRatio) return {...scale(current,after.quantity/current.quantity),...after} as T;
  return applyBasis(current,next);
}

export function nutrientRescaleWarning<T extends BasisCarrier>(current:T,next:BasisChange|number):string|undefined{
  if(typeof next==='number'||Object.keys(next).every(key=>key==='quantity'))return undefined;
  const before=resolveGrams(current as PortionBasis);
  const after=resolveGrams(basis(current,next));
  const changed=Object.keys(next).some(key=>key!=='quantity');
  return changed&&!(before!=null&&after!=null)
    ?'Nutrients were not rescaled — the previous portion has no gram weight. Check these values.'
    :undefined;
}

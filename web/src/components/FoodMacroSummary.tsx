import {number} from '../lib/format';

type MacroValues={protein:number|null;carbs:number|null;fat:number|null;fiber?:number|null};

const macros=[
  {key:'protein',short:'P',label:'Protein'},
  {key:'carbs',short:'C',label:'Carbs'},
  {key:'fat',short:'F',label:'Fat'},
] as const;

export function FoodMacroSummary({protein,carbs,fat,fiber,includeFiber=false,className=''}:MacroValues&{includeFiber?:boolean;className?:string}){
  const values={protein,carbs,fat,fiber};
  const items=[...macros,...(includeFiber&&fiber!=null?[{key:'fiber',short:'Fi',label:'Fibre'} as const]:[])];
  const accessible=items.map(item=>`${item.label} ${number(values[item.key],1)} g`).join(', ');
  return <div className={`food-macro-summary${className?` ${className}`:''}`} role="group" aria-label={`Macros: ${accessible}`}>
    {items.map(item=><span key={item.key} className={`food-macro ${item.key}`} aria-hidden="true"><b>{item.short}</b> {number(values[item.key],1)} <small>g</small></span>)}
  </div>;
}

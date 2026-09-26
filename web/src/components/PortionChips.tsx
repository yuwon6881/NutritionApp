import {Button} from './ui/Button';

const SERVING_STEPS:ReadonlyArray<{value:number;label:string;name:string}>=[
  {value:.5,label:'½',name:'Half a serving'},
  {value:1,label:'1',name:'One serving'},
  {value:1.5,label:'1½',name:'One and a half servings'},
  {value:2,label:'2',name:'Two servings'},
];

/**
 * One-tap serving multiples so a phone keyboard is optional. Multiplying
 * servings rescales the known nutrients proportionally and never invents a
 * gram weight for a serving that has none.
 */
export function PortionChips({quantity,unitLabel,onChange}:{quantity:number;unitLabel:string;onChange:(quantity:number)=>void}){
  return <div className="portion-chips" role="group" aria-label={`Quick ${unitLabel} amounts`}>
    {SERVING_STEPS.map(step=><Button
      key={step.value}
      type="button"
      size="sm"
      variant={quantity===step.value?'primary':'secondary'}
      aria-pressed={quantity===step.value}
      aria-label={step.name}
      onClick={()=>onChange(step.value)}
    >
      {step.label}
    </Button>)}
  </div>;
}

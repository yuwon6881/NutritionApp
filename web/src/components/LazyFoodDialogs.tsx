import {lazy, Suspense, type ComponentProps} from 'react';

// Both open only from a food entry's action menu, so their code stays out of the first load.
const Copy=lazy(()=>import('./CopyFoodDialog').then(module=>({default:module.CopyFoodDialog})));
const Move=lazy(()=>import('./MoveFoodDialog').then(module=>({default:module.MoveFoodDialog})));

export function CopyFoodDialog(props:ComponentProps<typeof Copy>){
  return <Suspense fallback={null}><Copy {...props}/></Suspense>;
}

export function MoveFoodDialog(props:ComponentProps<typeof Move>){
  return <Suspense fallback={null}><Move {...props}/></Suspense>;
}

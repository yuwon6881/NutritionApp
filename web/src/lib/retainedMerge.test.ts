import {expect,it} from 'vitest';
import {mergeRetained} from './retainedMerge';
const key=(item:{id:string})=>item.id;
it('retains both tabs additions and removes only an acknowledged version',()=>{
  const a={id:'a',value:1};const b={id:'b',value:2};
  expect(mergeRetained([a],[],[b],key)).toEqual([a,b]);
  expect(mergeRetained([a,b],[a],[],key)).toEqual([b]);
  expect(mergeRetained([{...a,value:3},b],[a],[],key)).toEqual([{...a,value:3},b]);
});

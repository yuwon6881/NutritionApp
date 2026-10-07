import {expect,it} from 'vitest';
import {mergeRetained} from './retainedMerge';
const key=(item:{id:string})=>item.id;
it('retains both tabs additions and removes only an acknowledged version',()=>{
  const a={id:'a',value:1};const b={id:'b',value:2};
  expect(mergeRetained([a],[],[b],key)).toEqual([a,b]);
  expect(mergeRetained([a,b],[a],[],key)).toEqual([b]);
  expect(mergeRetained([{...a,value:3},b],[a],[],key)).toEqual([{...a,value:3},b]);
});
it('treats a durable copy as unchanged by content, not by reference, without serializing it',()=>{
  const image='x'.repeat(2_000_000);
  const draft={id:'d',photos:[{angle:'front',data:image}],retryAt:undefined as number|undefined,steps:[{path:'a',input:{n:1}}]};
  const durable=structuredClone(draft);
  const updated={...draft,retryAt:5};
  expect(mergeRetained([durable],[draft],[updated],key)).toEqual([updated]);
  expect(mergeRetained([durable],[draft],[],key)).toEqual([]);
  // Another tab changed a small field or a nested step: its version wins over this tab's stale delta.
  for(const newer of [{...durable,retryAt:9},{...durable,steps:[{path:'a',input:{n:2}}]},{...durable,photos:[{angle:'front',data:`${image}y`}]}])
    expect(mergeRetained([newer],[draft],[updated],key)).toEqual([newer]);
});

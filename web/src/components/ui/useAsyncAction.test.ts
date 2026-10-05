import {expect,it,vi} from 'vitest';
// Exercise the hook's imperative dispatcher without a DOM renderer; React state is visual only.
vi.mock('react',()=>({useCallback:(f:unknown)=>f,useRef:(value:unknown)=>({current:value}),
  useState:(value:unknown)=>[value,vi.fn()],useEffect:()=>undefined}));
import {useAsyncAction} from './useAsyncAction';
it('different actions never receive the running action result, while identical keys share it',async()=>{
  const hook=useAsyncAction(10000);let complete!:(value:string)=>void;
  const first=hook.run(()=>new Promise<string>(resolve=>{complete=resolve;}),'image');
  const other=vi.fn(async()=>123);
  await expect(hook.run(other,'save')).rejects.toThrow('Another action');expect(other).not.toHaveBeenCalled();
  const duplicate=hook.run(other,'image');complete('prepared');
  expect(await first).toBe('prepared');expect(await duplicate).toBe('prepared');expect(other).not.toHaveBeenCalled();
});

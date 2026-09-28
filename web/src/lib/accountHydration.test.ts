import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('./local',()=>({readLocal:vi.fn(async()=>undefined)}));
import {readLocal} from './local';
import {hydrateAccount,clearAccountHydration} from './accountHydration';
beforeEach(()=>{clearAccountHydration();vi.clearAllMocks();});
it('shares startup hydration only for the active account',async()=>{
  const first=hydrateAccount('alice');
  expect(hydrateAccount('alice')).toBe(first);
  const second=hydrateAccount('bob');
  clearAccountHydration('alice');
  expect(hydrateAccount('bob')).toBe(second);
  await Promise.all([first,second]);
  expect(readLocal).toHaveBeenCalledTimes(2);
  clearAccountHydration();await hydrateAccount('bob');
  expect(readLocal).toHaveBeenCalledTimes(3);
});

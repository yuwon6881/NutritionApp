import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('./local',()=>({readLocal:vi.fn(),readRetainedMutations:vi.fn(),readDrafts:vi.fn()}));
import {readDrafts,readLocal,readRetainedMutations} from './local';
import {reloadRetainedWork} from './retainedReload';
import type {LocalData,Mutation} from '../types';

const op=(id:string,version=1)=>({id,kind:'entry',recordId:`record-${id}`,version,payload:{name:id}}) as unknown as Mutation;
const local=(queue:Mutation[]=[],extra:Partial<LocalData>={})=>({state:{revision:4},queue,...extra}) as unknown as LocalData;
const durable=local([op('from-other-tab')]);
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(readLocal).mockResolvedValue(durable);
  vi.mocked(readRetainedMutations).mockResolvedValue({queue:[],conflicts:[]});
  vi.mocked(readDrafts).mockResolvedValue({});
});

it('keeps the in-memory snapshot on an idle wake without reading the account partitions',async()=>{
  const current=local();
  expect(await reloadRetainedWork('alice',current,'queue')).toBe(current);
  expect(await reloadRetainedWork('alice',current,'drafts')).toBe(current);
  expect(readLocal).not.toHaveBeenCalled();
});

it('keeps the snapshot when the durable queue matches what is already in memory',async()=>{
  const current=local([op('a'),op('b',2)]);
  vi.mocked(readRetainedMutations).mockResolvedValue({queue:[op('a'),op('b',2)],conflicts:[]});
  expect(await reloadRetainedWork('alice',current,'queue')).toBe(current);
  expect(readLocal).not.toHaveBeenCalled();
});

it('reloads everything when another tab queued, removed, or rewrote work even if its broadcast was missed',async()=>{
  for(const [memory,stored] of [[[],[op('from-other-tab')]],[[op('a')],[]],[[op('a')],[op('a',2)]]] as const){
    vi.mocked(readRetainedMutations).mockResolvedValueOnce({queue:[...stored],conflicts:[]});
    expect(await reloadRetainedWork('alice',local([...memory]),'queue')).toBe(durable);
  }
  expect(readLocal).toHaveBeenCalledTimes(3);
  expect(readLocal).toHaveBeenCalledWith('alice');
});

it('reloads when another tab adds a conflict without changing the dispatch queue',async()=>{
  const conflict={id:'conflict',mutation:op('conflict'),message:'Review this change.',date:'2026-01-01',createdAt:1};
  vi.mocked(readRetainedMutations).mockResolvedValueOnce({queue:[],conflicts:[conflict]});
  expect(await reloadRetainedWork('alice',local(),'queue')).toBe(durable);
  expect(readLocal).toHaveBeenCalledWith('alice');
});

it('reloads whenever either side holds drafts, without comparing image content',async()=>{
  vi.mocked(readDrafts).mockResolvedValueOnce({photoDrafts:[{id:'p'}]} as never);
  expect(await reloadRetainedWork('alice',local(),'drafts')).toBe(durable);
  expect(await reloadRetainedWork('alice',local([],{bodyDrafts:[{id:'b'}]} as never),'drafts')).toBe(durable);
  expect(readLocal).toHaveBeenCalledTimes(2);
});

it('falls back to a full read when nothing is loaded yet',async()=>{
  expect(await reloadRetainedWork('alice',undefined,'queue')).toBe(durable);
  expect(readRetainedMutations).not.toHaveBeenCalled();
});

import {afterEach,describe,expect,it,vi} from 'vitest';
import type {FoodSearchResult} from '../types';
import {FoodVerificationRecovery,VERIFY_COOLDOWN_MS,VERIFY_RETRY_MS} from './foodVerificationRecovery';
import {applyVerifiedFoods} from './foodVerification';

const hit:FoodSearchResult={name:'Whey',calories:117,protein:24,fat:1,carbs:3,fiber:null,source:'Open Food Facts / ODbL',code:'0748927065725',basis:'unverified',servingGrams:100,portions:[]};
const confirmed:FoodSearchResult={...hit,calories:385,protein:79,basis:'per100g'};

function setup(read:(codes:string[])=>Promise<FoodSearchResult[]>){
  const cache=new Map([['whey',[hit]]]);
  const states:boolean[]=[];
  let active='whey';
  const recovery=new FoodVerificationRecovery({read,results:key=>cache.get(key)??[],active:key=>active===key,
    apply:(key,verified)=>cache.set(key,applyVerifiedFoods(cache.get(key)??[],verified)),
    changed:(_key,confirming)=>states.push(confirming)});
  return {recovery,cache,states,show:(key:string)=>{active=key;}};
}

afterEach(()=>vi.useRealTimers());

describe('food verification recovery',()=>{
  it('coalesces duplicate requests and retries an empty answer once after pacing',async()=>{
    vi.useFakeTimers();
    const read=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([confirmed]);
    const {recovery,cache}=setup(read);
    recovery.confirm('whey');recovery.confirm('whey');
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS);
    expect(read).toHaveBeenCalledTimes(2);
    expect(cache.get('whey')?.[0].basis).toBe('per100g');
    await vi.advanceTimersByTimeAsync(VERIFY_COOLDOWN_MS);
    expect(read).toHaveBeenCalledTimes(2);
    recovery.dispose();
  });

  it('reports confirming through the retry wait and stops once the rows are confirmed',async()=>{
    vi.useFakeTimers();
    const read=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([confirmed]);
    const {recovery,states}=setup(read);
    recovery.confirm('whey');
    expect(states).toEqual([true]);
    await vi.advanceTimersByTimeAsync(0);
    // The empty first answer does not flash the plain text: the rows stay confirming while the retry waits.
    expect(states).toEqual([true]);
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS);
    expect(states).toEqual([true,true,false]);
    recovery.dispose();
  });

  it('stops reporting confirming when the last attempt leaves rows unresolved',async()=>{
    vi.useFakeTimers();
    const read=vi.fn().mockResolvedValue([]);
    const {recovery,states}=setup(read);
    recovery.confirm('whey');
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS);
    expect(read).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe(false);
    recovery.dispose();
  });

  it('bounds failed recovery and allows a later cached-query attempt after cooldown',async()=>{
    vi.useFakeTimers();
    const read=vi.fn().mockRejectedValue(new Error('Provider unavailable'));
    const {recovery,cache}=setup(read);
    recovery.confirm('whey');
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS);
    expect(read).toHaveBeenCalledTimes(2);
    recovery.confirm('whey');
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(VERIFY_COOLDOWN_MS);
    expect(read).toHaveBeenCalledTimes(2);
    read.mockResolvedValueOnce([confirmed]);recovery.confirm('whey');
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.get('whey')?.[0].basis).toBe('per100g');
    recovery.dispose();
  });

  it('does not spend a recovery request after the user leaves the query',async()=>{
    vi.useFakeTimers();
    const read=vi.fn().mockResolvedValue([]);
    const {recovery,show}=setup(read);
    recovery.confirm('whey');await vi.advanceTimersByTimeAsync(0);show('rice');
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS);
    expect(read).toHaveBeenCalledTimes(1);
    show('whey');recovery.confirm('whey');await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    recovery.dispose();
  });

  it('clears scheduled retries when the search panel unmounts',async()=>{
    vi.useFakeTimers();
    const read=vi.fn().mockResolvedValue([]);
    const {recovery}=setup(read);
    recovery.confirm('whey');await vi.advanceTimersByTimeAsync(0);recovery.dispose();
    await vi.advanceTimersByTimeAsync(VERIFY_RETRY_MS);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

import {afterEach,describe,expect,it,vi} from 'vitest';
import {frameTask} from './frameTask';
import {singleFlight} from './singleFlight';
import {imageDimensions,jpegWithinLimit} from './imageEncoding';
import {nearestIndex} from './chartScrub';

afterEach(()=>vi.unstubAllGlobals());
describe('performance primitives',()=>{
  it('coalesces samples and flushes release without leaving an animation frame',()=>{
    let callback:FrameRequestCallback|undefined;
    const cancel=vi.fn();
    vi.stubGlobal('requestAnimationFrame',(next:FrameRequestCallback)=>{callback=next;return 7;});
    vi.stubGlobal('cancelAnimationFrame',cancel);
    const apply=vi.fn();const task=frameTask(apply);
    task.schedule(1);task.schedule(2);task.flush();
    expect(apply).toHaveBeenCalledExactlyOnceWith(2);
    expect(cancel).toHaveBeenCalledWith(7);
    callback?.(0);expect(apply).toHaveBeenCalledTimes(1);
    task.schedule(3);task.cancel();callback?.(0);
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it('shares overlapping reads and releases rejected requests for retry',async()=>{
    const requests=new Map<string,Promise<number>>();
    let reject!:(error:Error)=>void;
    const read=vi.fn(()=>new Promise<number>((_,fail)=>{reject=fail;}));
    const first=singleFlight(requests,'account:resource',read);
    expect(singleFlight(requests,'account:resource',read)).toBe(first);
    reject(new Error('offline'));await expect(first).rejects.toThrow('offline');
    expect(requests.size).toBe(0);
    expect(await singleFlight(requests,'account:resource',async()=>2)).toBe(2);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('keeps image dimensions, quality fallbacks and encoded payload limits',async()=>{
    expect(imageDimensions(4000,3000)).toEqual({width:1600,height:1200});
    expect(imageDimensions(200,100)).toEqual({width:200,height:100});
    const encode=vi.fn(async(quality:number)=>new Blob([new Uint8Array(quality>.65?12:6)]));
    expect((await jpegWithinLimit(encode,8)).size).toBe(6);
    expect(encode.mock.calls.map(call=>call[0])).toEqual([.82,.65]);
    await expect(jpegWithinLimit(async()=>new Blob([new Uint8Array(9)]),8)).rejects.toThrow('fit');
  });
  it('preserves the earliest point for duplicate positions and distance ties',()=>{
    expect(nearestIndex([1,1,5],3)).toBe(0);
    expect(nearestIndex([1,5,5],9)).toBe(1);
    expect(nearestIndex([],3)).toBe(-1);
  });
});

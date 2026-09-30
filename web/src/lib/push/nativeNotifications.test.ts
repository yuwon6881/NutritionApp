import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {registerNativePushAndGetToken} from './nativeNotifications';

const push=vi.hoisted(()=>({
  createChannel:vi.fn(),addListener:vi.fn(),register:vi.fn(),
}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android'}}));
vi.mock('@capacitor/push-notifications',()=>({PushNotifications:push}));

describe('native registration lifecycle',()=>{
  const listeners=new Map<string,(event:{value:string;error:string})=>void>();
  const removals:ReturnType<typeof vi.fn>[]=[];

  beforeEach(()=>{
    vi.useFakeTimers();vi.resetAllMocks();listeners.clear();removals.length=0;
    push.addListener.mockImplementation(async(name,callback)=>{
      listeners.set(name,callback);
      const remove=vi.fn().mockResolvedValue(undefined);removals.push(remove);
      return {remove};
    });
  });
  afterEach(()=>vi.useRealTimers());

  it('removes a handle delivered after a retained token already settled registration',async()=>{
    const remove=vi.fn().mockResolvedValue(undefined);
    push.addListener.mockImplementationOnce(async(_name,callback)=>{
      callback({value:'retained-token'});
      return {remove};
    });
    expect(await registerNativePushAndGetToken()).toBe('retained-token');
    await vi.waitFor(()=>expect(remove).toHaveBeenCalledOnce());
    expect(push.addListener).toHaveBeenCalledTimes(1);
    expect(push.register).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans both listeners and the deadline after normal success',async()=>{
    push.register.mockImplementation(async()=>listeners.get('registration')?.({value:'fresh-token',error:''}));
    expect(await registerNativePushAndGetToken()).toBe('fresh-token');
    expect(removals).toHaveLength(2);
    for(const remove of removals)expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans a registration-error handle delivered after its callback',async()=>{
    push.addListener.mockImplementation(async(name,callback)=>{
      const remove=vi.fn().mockResolvedValue(undefined);removals.push(remove);
      if(name==='registrationError')callback({error:'Firebase unavailable'});
      return {remove};
    });
    await expect(registerNativePushAndGetToken()).rejects.toThrow('Firebase unavailable');
    await vi.waitFor(()=>{for(const remove of removals)expect(remove).toHaveBeenCalledOnce();});
    expect(push.register).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up when registration times out',async()=>{
    const pending=registerNativePushAndGetToken(100);
    const result=expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await result;
    for(const remove of removals)expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not accumulate listeners across repeated foreground registrations',async()=>{
    push.register.mockImplementation(async()=>listeners.get('registration')?.({value:'token',error:''}));
    for(let attempt=0;attempt<3;attempt++)await registerNativePushAndGetToken();
    expect(removals).toHaveLength(6);
    for(const remove of removals)expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

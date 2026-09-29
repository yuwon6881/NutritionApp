import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>false}}));
vi.mock('@capacitor/haptics',()=>({Haptics:{},ImpactStyle:{Light:'LIGHT'},NotificationType:{Success:'SUCCESS',Warning:'WARNING'}}));

const {hapticTick,setHapticsEnabled}=await import('./haptics');

describe('hapticTick on the web',()=>{
  const vibrate=vi.fn();
  const store=new Map<string,string>();
  beforeEach(()=>{
    vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)});
    vi.stubGlobal('window',{matchMedia:()=>({matches:false})});
    vi.stubGlobal('navigator',{vibrate});
  });
  afterEach(()=>{vibrate.mockReset();store.clear();vi.unstubAllGlobals();});

  it('gives each kind a distinct pattern',()=>{
    hapticTick('selection');hapticTick('success');hapticTick('warning');
    expect(vibrate.mock.calls.map(call=>call[0])).toEqual([35,[20,40,20],[40,60,40]]);
  });
  it('stays silent when the person turned haptics off',()=>{
    setHapticsEnabled(false);
    hapticTick('warning');
    expect(vibrate).not.toHaveBeenCalled();
  });
  it('stays silent under reduced motion',()=>{
    vi.stubGlobal('window',{matchMedia:()=>({matches:true})});
    hapticTick('success');
    expect(vibrate).not.toHaveBeenCalled();
  });
});

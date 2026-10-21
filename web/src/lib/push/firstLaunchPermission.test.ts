import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({android:true,check:vi.fn(),request:vi.fn()}));
vi.mock('./nativeNotifications',()=>({
  isNativeAndroid:()=>native.android,
  checkNativeNotificationPermission:native.check,
  requestNativeNotificationPermission:native.request,
}));
import {NOTIFICATION_PROMPT_KEY,promptNotificationsOnFirstLaunch} from './firstLaunchPermission';

function memoryStorage():Storage{
  const values=new Map<string,string>();
  return {get length(){return values.size;},clear:()=>values.clear(),getItem:key=>values.get(key)??null,key:index=>[...values.keys()][index]??null,
    removeItem:key=>{values.delete(key);},setItem:(key,value)=>{values.set(key,String(value));}};
}
const settled=()=>Promise.resolve();

describe('first-launch notification prompt',()=>{
  beforeEach(()=>{vi.resetAllMocks();native.android=true;vi.stubGlobal('localStorage',memoryStorage());});
  afterEach(()=>vi.unstubAllGlobals());

  it('asks once on the first Android launch',async()=>{
    native.check.mockResolvedValue('prompt');
    native.request.mockResolvedValue('granted');
    await promptNotificationsOnFirstLaunch(settled);
    await promptNotificationsOnFirstLaunch(settled);
    expect(native.request).toHaveBeenCalledOnce();
    expect(localStorage.getItem(NOTIFICATION_PROMPT_KEY)).not.toBeNull();
  });

  it('records a refusal so the app does not ask again',async()=>{
    native.check.mockResolvedValue('prompt');
    native.request.mockResolvedValue('denied');
    await promptNotificationsOnFirstLaunch(settled);
    expect(localStorage.getItem(NOTIFICATION_PROMPT_KEY)).not.toBeNull();
  });

  it('retries on the next launch when Android dropped the request',async()=>{
    native.check.mockResolvedValue('prompt');
    native.request.mockResolvedValue('prompt');
    await promptNotificationsOnFirstLaunch(settled);
    expect(localStorage.getItem(NOTIFICATION_PROMPT_KEY)).toBeNull();
    await promptNotificationsOnFirstLaunch(settled);
    expect(native.request).toHaveBeenCalledTimes(2);
  });

  it('waits for the app to settle before asking',async()=>{
    native.check.mockResolvedValue('prompt');
    native.request.mockResolvedValue('granted');
    let release=()=>{};
    const pending=promptNotificationsOnFirstLaunch(()=>new Promise<void>(resolve=>{release=resolve;}));
    await Promise.resolve();
    expect(native.check).not.toHaveBeenCalled();
    release();
    await pending;
    expect(native.request).toHaveBeenCalledOnce();
  });

  it('does not ask when permission is already decided',async()=>{
    native.check.mockResolvedValue('granted');
    await promptNotificationsOnFirstLaunch(settled);
    expect(native.request).not.toHaveBeenCalled();
    expect(localStorage.getItem(NOTIFICATION_PROMPT_KEY)).not.toBeNull();
  });

  it('never asks outside the Android app',async()=>{
    native.android=false;
    await promptNotificationsOnFirstLaunch(settled);
    expect(native.check).not.toHaveBeenCalled();
    expect(localStorage.getItem(NOTIFICATION_PROMPT_KEY)).toBeNull();
  });

  it('keeps launch going when the plugin fails',async()=>{
    native.check.mockRejectedValue(new Error('Unavailable'));
    await expect(promptNotificationsOnFirstLaunch(settled)).resolves.toBeUndefined();
  });
});

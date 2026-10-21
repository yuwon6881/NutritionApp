import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchNotificationStatus,registerNotificationDevice} from '../notifications';
import {savePushDeviceCredential} from '../local';
import {checkNativeNotificationPermission,isNativeAndroid,registerNativePushAndGetToken} from './nativeNotifications';
import {reconcileNotificationDevice} from './deviceLifecycle';
import {setDevicePushOptOut} from './deviceOptOut';

vi.mock('../notifications',()=>({fetchNotificationStatus:vi.fn(),registerNotificationDevice:vi.fn()}));
vi.mock('../local',()=>({
  savePushDeviceCredential:vi.fn(),readPushDeviceCredential:vi.fn(),deletePushDeviceCredential:vi.fn(),savePushRevocation:vi.fn()
}));
vi.mock('./nativeNotifications',()=>({
  isNativeAndroid:vi.fn(),checkNativeNotificationPermission:vi.fn(),registerNativePushAndGetToken:vi.fn(),unregisterNativePush:vi.fn()
}));

const unsubscribed={configured:true,thisDeviceSubscribed:false} as Awaited<ReturnType<typeof fetchNotificationStatus>>;

function memoryStorage():Storage{
  const values=new Map<string,string>();
  return {get length(){return values.size;},clear:()=>values.clear(),getItem:key=>values.get(key)??null,key:index=>[...values.keys()][index]??null,
    removeItem:key=>{values.delete(key);},setItem:(key,value)=>{values.set(key,String(value));}};
}

afterEach(()=>vi.unstubAllGlobals());

beforeEach(()=>{
  vi.clearAllMocks();
  vi.stubGlobal('localStorage',memoryStorage());
  vi.stubGlobal('window',new EventTarget());
  vi.mocked(fetchNotificationStatus).mockResolvedValue(unsubscribed);
  vi.mocked(isNativeAndroid).mockReturnValue(true);
  vi.mocked(checkNativeNotificationPermission).mockResolvedValue('granted');
  vi.mocked(registerNativePushAndGetToken).mockResolvedValue('token-1');
});

it('subscribes an Android device by itself once the notification permission is allowed',async()=>{
  const enabled=vi.fn();
  window.addEventListener('nutrition-push-enabled',enabled);
  await reconcileNotificationDevice('alice','phone');
  window.removeEventListener('nutrition-push-enabled',enabled);
  expect(savePushDeviceCredential).toHaveBeenCalledWith('alice','phone','token-1');
  expect(registerNotificationDevice).toHaveBeenCalledWith('phone','token-1','android');
  expect(enabled).toHaveBeenCalledTimes(1);
});

it('leaves a device without the permission unsubscribed',async()=>{
  vi.mocked(checkNativeNotificationPermission).mockResolvedValue('prompt');
  await reconcileNotificationDevice('alice','phone');
  expect(registerNativePushAndGetToken).not.toHaveBeenCalled();
  expect(registerNotificationDevice).not.toHaveBeenCalled();
});

it('keeps a device the person turned off unsubscribed',async()=>{
  setDevicePushOptOut('alice','phone',true);
  await reconcileNotificationDevice('alice','phone');
  expect(registerNotificationDevice).not.toHaveBeenCalled();
  setDevicePushOptOut('alice','phone',false);
  await reconcileNotificationDevice('alice','phone');
  expect(registerNotificationDevice).toHaveBeenCalledTimes(1);
});

it('never subscribes a browser by itself',async()=>{
  vi.mocked(isNativeAndroid).mockReturnValue(false);
  await reconcileNotificationDevice('alice','phone');
  expect(registerNotificationDevice).not.toHaveBeenCalled();
});

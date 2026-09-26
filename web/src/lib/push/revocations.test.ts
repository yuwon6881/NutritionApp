import {describe,expect,it,vi,beforeEach} from 'vitest';
import {drainPendingPushRevocations, revokeMatchingPushDevices} from './revocations';
import type {PushRevocation} from '../local';
import {readPushRevocations, deletePushRevocation, deletePushDeviceCredential} from '../local';
import {revokePushDeviceSubscription} from '../notifications';

vi.mock('../local', () => ({
  readPushRevocations: vi.fn(),
  deletePushRevocation: vi.fn(),
  deletePushDeviceCredential: vi.fn(),
}));

vi.mock('../notifications', () => ({
  revokePushDeviceSubscription: vi.fn(),
  removeNotificationDevice: vi.fn(),
}));

const revocation=(userId:string,deviceId:string,fcmToken:string):PushRevocation=>({
  version:1,id:`${userId}:${deviceId}`,userId,deviceId,fcmToken,requestedAt:1
});

describe('account-scoped push revocations',()=>{
  it('retries only records owned by the authenticated account with their exact token',async()=>{
    const records=[revocation('account-a','device-a','old-token'),revocation('account-b','device-b','other-token')];
    const revoke=vi.fn(async()=>undefined);
    const retire=vi.fn(async()=>undefined);

    await revokeMatchingPushDevices(records,'account-a',revoke,retire);

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('device-a','old-token');
    expect(retire).toHaveBeenCalledTimes(1);
    expect(retire).toHaveBeenCalledWith(records[0]);
  });

  it('keeps the revocation record if the server could not confirm revocation',async()=>{
    const record=revocation('account-a','device-a','token-a');
    const revoke=vi.fn(async()=>{throw new Error('offline');});
    const retire=vi.fn(async()=>undefined);

    await expect(revokeMatchingPushDevices([record],'account-a',revoke,retire)).rejects.toThrow('offline');
    expect(retire).not.toHaveBeenCalled();
  });
});

describe('drainPendingPushRevocations',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
  });

  it('drains pending revocations and retires local evidence only upon success',async()=>{
    const r1=revocation('user-1','device-1','token-1');
    const r2=revocation('user-2','device-2','token-2');
    vi.mocked(readPushRevocations).mockResolvedValue([r1,r2]);
    vi.mocked(revokePushDeviceSubscription).mockResolvedValue(undefined);
    vi.mocked(deletePushRevocation).mockResolvedValue(undefined);
    vi.mocked(deletePushDeviceCredential).mockResolvedValue(undefined);

    await drainPendingPushRevocations();

    expect(revokePushDeviceSubscription).toHaveBeenCalledWith('user-1','device-1','token-1',undefined);
    expect(revokePushDeviceSubscription).toHaveBeenCalledWith('user-2','device-2','token-2',undefined);
    expect(deletePushRevocation).toHaveBeenCalledWith('user-1:device-1');
    expect(deletePushRevocation).toHaveBeenCalledWith('user-2:device-2');
    expect(deletePushDeviceCredential).toHaveBeenCalledWith('user-1','device-1','token-1');
    expect(deletePushDeviceCredential).toHaveBeenCalledWith('user-2','device-2','token-2');
  });

  it('retains local revocation record if revocation endpoint throws',async()=>{
    const r1=revocation('user-1','device-1','token-1');
    vi.mocked(readPushRevocations).mockResolvedValue([r1]);
    vi.mocked(revokePushDeviceSubscription).mockRejectedValue(new Error('Network failure'));

    await drainPendingPushRevocations();

    expect(revokePushDeviceSubscription).toHaveBeenCalledTimes(1);
    expect(deletePushRevocation).not.toHaveBeenCalled();
    expect(deletePushDeviceCredential).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent drain calls',async()=>{
    vi.mocked(readPushRevocations).mockImplementation(async()=>{
      await new Promise(resolve=>setTimeout(resolve,10));
      return [];
    });

    const p1=drainPendingPushRevocations();
    const p2=drainPendingPushRevocations();
    expect(p1).toBe(p2);
    await Promise.all([p1,p2]);
    expect(readPushRevocations).toHaveBeenCalledTimes(1);
  });

  it('uses owner-bound capability requests without probing the changing session',async()=>{
    const fetch=vi.fn();
    vi.stubGlobal('fetch',fetch);
    try{
      vi.mocked(readPushRevocations).mockResolvedValue([revocation('old-account','device','old-token')]);
      vi.mocked(revokePushDeviceSubscription).mockResolvedValue(undefined);
      await drainPendingPushRevocations();
      expect(fetch).not.toHaveBeenCalled();
      expect(revokePushDeviceSubscription).toHaveBeenCalledWith('old-account','device','old-token',undefined);
      expect(deletePushRevocation).toHaveBeenCalledWith('old-account:device');
    }finally{vi.unstubAllGlobals();}
  });
});

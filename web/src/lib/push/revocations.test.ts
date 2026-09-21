import {describe,expect,it,vi} from 'vitest';
import {revokeMatchingPushDevices} from './revocations';
import type {PushRevocation} from '../local';

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

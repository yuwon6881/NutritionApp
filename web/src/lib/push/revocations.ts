import {api, type ApiFetchOptions} from '../api';
import {deletePushDeviceCredential, deletePushRevocation, readPushRevocations, type PushRevocation} from '../local';
import {removeNotificationDevice} from '../notifications';

const activeDrains=new Map<string,Promise<void>>();

export async function revokeMatchingPushDevices(
  records: PushRevocation[],
  authenticatedUserId: string,
  revoke: (deviceId: string, fcmToken: string) => Promise<void>,
  retire: (record: PushRevocation) => Promise<void>
): Promise<void> {
  for (const record of records) {
    if (record.userId !== authenticatedUserId) continue;
    await revoke(record.deviceId, record.fcmToken);
    await retire(record);
  }
}

export function retryPendingPushRevocations(expectedUserId?: string, options?: ApiFetchOptions): Promise<void> {
  const key=`${expectedUserId??'current'}:${options?.signal?'bounded':'default'}`;
  const active=activeDrains.get(key);
  if(active)return active;
  const task = (async()=>{
    const records = await readPushRevocations();
    if (records.length === 0) return;
    const session = await api<{id:string}>('/auth/me', undefined, 'GET', options);
    if (!session.id || (expectedUserId && session.id !== expectedUserId)) return;
    await revokeMatchingPushDevices(
      records,
      session.id,
      (deviceId, fcmToken) => removeNotificationDevice(deviceId, fcmToken, options),
      async record => {
        await deletePushRevocation(record.id);
        await deletePushDeviceCredential(record.userId, record.deviceId, record.fcmToken);
      }
    );
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('nourish-push-revocation-drained'));
  })();
  const drain=task.finally(()=>{if(activeDrains.get(key)===drain)activeDrains.delete(key);});
  activeDrains.set(key,drain);
  return drain;
}

export async function revokePushDeviceForCurrentAccount(
  userId: string,
  deviceId: string,
  fcmToken: string,
  options?: ApiFetchOptions
): Promise<boolean> {
  const session = await api<{id:string}>('/auth/me', undefined, 'GET', options);
  if (session.id !== userId) return false;
  await removeNotificationDevice(deviceId, fcmToken, options);
  await deletePushDeviceCredential(userId, deviceId, fcmToken);
  return true;
}

import {api, type ApiFetchOptions} from '../api';
import {deletePushDeviceCredential, deletePushRevocation, readPushRevocations, type PushRevocation} from '../local';
import {removeNotificationDevice, revokePushDeviceSubscription} from '../notifications';

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

/** Drains durable push revocations using the dedicated device capability endpoint.
 *  Can run while signed out or across accounts without requiring an active session. */
export function drainPendingPushRevocations(options?: ApiFetchOptions): Promise<void> {
  const key = `all-accounts:${options?.signal ? 'bounded' : 'default'}`;
  const active = activeDrains.get(key);
  if (active) return active;
  const task = (async () => {
    const records = await readPushRevocations();
    if (records.length === 0) return;
    for (const record of records) {
      try {
        await revokePushDeviceSubscription(record.userId, record.deviceId, record.fcmToken, options);
        await deletePushRevocation(record.id);
        await deletePushDeviceCredential(record.userId, record.deviceId, record.fcmToken);
      } catch {
        // Retain record for next retry on reconnect or next startup.
      }
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('nourish-push-revocation-drained'));
  })();
  const drain = task.finally(() => { if (activeDrains.get(key) === drain) activeDrains.delete(key); });
  activeDrains.set(key, drain);
  return drain;
}

export function retryPendingPushRevocations(_expectedUserId?: string, options?: ApiFetchOptions): Promise<void> {
  return drainPendingPushRevocations(options);
}

export function retryAllPendingPushRevocations(options?: ApiFetchOptions): Promise<void> {
  return drainPendingPushRevocations(options);
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

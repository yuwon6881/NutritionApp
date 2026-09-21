import { database } from '../local';
import { idbDelete, idbGet, idbGetAllKeys, idbPut } from '../idb';

export interface PushRevocation {
  version: 1;
  id: string;
  userId: string;
  deviceId: string;
  fcmToken: string;
  requestedAt: number;
}

export interface PushDeviceCredential {
  version: 1;
  userId: string;
  deviceId: string;
  fcmToken: string;
  updatedAt: number;
}

export function pushDeviceKey(userId: string, deviceId: string): string {
  return `${userId}:${deviceId}`;
}

export async function readPushRevocations(): Promise<PushRevocation[]> {
  const db = await database();
  const keys = await idbGetAllKeys(db, 'push_revocations');
  const records: PushRevocation[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    const value = await idbGet<PushRevocation>(db, 'push_revocations', key);
    if (value?.version === 1 && value.id === key && typeof value.userId === 'string' &&
      typeof value.deviceId === 'string' && typeof value.fcmToken === 'string' && value.fcmToken.length > 0) records.push(value);
  }
  return records;
}

export async function savePushRevocation(userId: string, deviceId: string, fcmToken: string): Promise<void> {
  const cleanUserId = userId.trim();
  const cleanDeviceId = deviceId.trim();
  const cleanToken = fcmToken.trim();
  if (!cleanUserId || !cleanDeviceId || !cleanToken) throw new Error('A signed-in account, device, and notification token are required to save revocation.');
  const db = await database();
  const id = crypto.randomUUID();
  return idbPut(db, 'push_revocations', {
    version: 1,
    id,
    userId: cleanUserId,
    deviceId: cleanDeviceId,
    fcmToken: cleanToken,
    requestedAt: Date.now()
  } satisfies PushRevocation, id);
}

export async function deletePushRevocation(id: string): Promise<void> {
  const db = await database();
  return idbDelete(db, 'push_revocations', id);
}

export async function readPushDeviceCredential(userId: string, deviceId: string): Promise<PushDeviceCredential | undefined> {
  const db = await database();
  const value = await idbGet<PushDeviceCredential>(db, 'push_devices', pushDeviceKey(userId, deviceId));
  return value?.version === 1 && value.userId === userId && value.deviceId === deviceId && typeof value.fcmToken === 'string'
    ? value
    : undefined;
}

export async function savePushDeviceCredential(userId: string, deviceId: string, fcmToken: string): Promise<void> {
  const cleanUserId = userId.trim();
  const cleanDeviceId = deviceId.trim();
  const cleanToken = fcmToken.trim();
  if (!cleanUserId || !cleanDeviceId || !cleanToken) throw new Error('A signed-in account, device, and notification token are required.');
  const db = await database();
  return idbPut(db, 'push_devices', {
    version: 1,
    userId: cleanUserId,
    deviceId: cleanDeviceId,
    fcmToken: cleanToken,
    updatedAt: Date.now()
  } satisfies PushDeviceCredential, pushDeviceKey(cleanUserId, cleanDeviceId));
}

export async function deletePushDeviceCredential(userId: string, deviceId: string, fcmToken: string): Promise<void> {
  const db = await database();
  const key = pushDeviceKey(userId, deviceId);
  const current = await idbGet<PushDeviceCredential>(db, 'push_devices', key);
  if (current?.fcmToken === fcmToken) await idbDelete(db, 'push_devices', key);
}

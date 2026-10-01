import {expect, it, vi} from 'vitest';
import {fetchNotificationStatus} from '../notifications';
import {reconcileNotificationDevice} from './deviceLifecycle';
vi.mock('../notifications', () => ({fetchNotificationStatus: vi.fn(), registerNotificationDevice: vi.fn()}));

it('coalesces device registration reads only within the same account and device', async () => {
  let finish!: (value: Awaited<ReturnType<typeof fetchNotificationStatus>>) => void;
  vi.mocked(fetchNotificationStatus).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = reconcileNotificationDevice('alice', 'phone');
  const duplicate = reconcileNotificationDevice('alice', 'phone');
  expect(fetchNotificationStatus).toHaveBeenCalledTimes(1);
  finish({configured: false, thisDeviceSubscribed: false} as Awaited<ReturnType<typeof fetchNotificationStatus>>);
  await Promise.all([first, duplicate]);
  vi.mocked(fetchNotificationStatus).mockResolvedValue({configured: false, thisDeviceSubscribed: false} as Awaited<ReturnType<typeof fetchNotificationStatus>>);
  await Promise.all([reconcileNotificationDevice('alice', 'phone'), reconcileNotificationDevice('bob', 'phone')]);
  expect(fetchNotificationStatus).toHaveBeenCalledTimes(3);
});

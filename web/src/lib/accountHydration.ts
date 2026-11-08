import type {LocalData} from '../types';
import {readLocal} from './local';

let active: {account: string; promise: Promise<LocalData | undefined>; value?: LocalData} | undefined;

/** Reuse only the initial read while App hands the active account to its workspace. */
export function hydrateAccount(account: string): Promise<LocalData | undefined> {
  if (active?.account === account) return active.promise;
  const promise = readLocal(account, false).then(data => {
    // Identity check: a newer read for the same or another account must not be overwritten.
    if (active?.promise === promise) active.value = data;
    return data;
  });
  active = {account,promise};
  void promise.catch(() => { if (active?.promise === promise) active = undefined; });
  return promise;
}

/** The finished startup read, so the workspace's first render can show the diary instead of a skeleton. */
export function getHydratedAccount(account: string | undefined): LocalData | undefined {
  return account && active?.account === account ? active.value : undefined;
}

export function clearAccountHydration(account?:string): void {
  if(account===undefined||active?.account===account)active=undefined;
}

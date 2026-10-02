import type {LocalData} from '../types';
import {readLocal} from './local';

let active: {account: string; promise: Promise<LocalData | undefined>} | undefined;

/** Reuse only the initial read while App hands the active account to its workspace. */
export function hydrateAccount(account: string): Promise<LocalData | undefined> {
  if (active?.account === account) return active.promise;
  const promise = readLocal(account, false);
  active = {account,promise};
  void promise.catch(() => { if (active?.promise === promise) active = undefined; });
  return promise;
}

export function clearAccountHydration(account?:string): void {
  if(account===undefined||active?.account===account)active=undefined;
}

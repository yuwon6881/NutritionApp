import {database} from './local';

type Lease={owner:string;until:number};
async function updateLease(account:string,owner:string,release=false):Promise<boolean>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('meta','readwrite');const store=tx.objectStore('meta');
    const key=`dispatch:${account}`;const request=store.get(key);let acquired=false;
    request.onsuccess=()=>{
      const lease=request.result as Lease|undefined;
      if(lease&&lease.owner!==owner&&lease.until>Date.now())return;
      acquired=true;
      if(release)store.delete(key);else store.put({owner,until:Date.now()+60000},key);
    };
    tx.oncomplete=()=>resolve(acquired);tx.onerror=()=>reject(tx.error??new Error('Local dispatch transaction failed.'));tx.onabort=()=>reject(tx.error??new Error('Local dispatch transaction failed.'));
  });
}
/** One account dispatcher across tabs; the lease expires after a crashed tab. */
export async function acquireAccountDispatch(account:string):Promise<(()=>Promise<void>)|undefined>{
  const owner=crypto.randomUUID();
  if(!await updateLease(account,owner))return undefined;
  const timer=setInterval(()=>{void updateLease(account,owner).catch(()=>undefined);},10000);
  return async()=>{clearInterval(timer);await updateLease(account,owner,true);};
}

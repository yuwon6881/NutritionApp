import {database} from './local';

type Lease={owner:string;until:number};
// The lease excludes other tabs, not this page: a wake runs the outbox drain and draft uploads
// together, and a per-call owner let whichever started second lock itself out.
let pageOwner:string|undefined;
function getPageOwner():string{
  if(pageOwner)return pageOwner;
  try{
    const stored=typeof sessionStorage!=='undefined'?sessionStorage.getItem('dispatch_page_owner'):null;
    if(stored)return (pageOwner=stored);
    const generated=crypto.randomUUID();
    try{sessionStorage?.setItem('dispatch_page_owner',generated);}catch{}
    return (pageOwner=generated);
  }catch{
    return (pageOwner=crypto.randomUUID());
  }
}
const owner=()=>getPageOwner();
const holders=new Map<string,number>();
const renewals=new Map<string,ReturnType<typeof setInterval>>();

async function updateLease(account:string,release=false):Promise<boolean>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('meta','readwrite');const store=tx.objectStore('meta');
    const key=`dispatch:${account}`;const request=store.get(key);let acquired=false;
    request.onsuccess=()=>{
      const lease=request.result as Lease|undefined;
      if(lease&&lease.owner!==owner()&&lease.until>Date.now())return;
      acquired=true;
      // A release racing a new acquisition in this page must leave the lease in place.
      if(release){if(!holders.get(account))store.delete(key);}
      else store.put({owner:owner(),until:Date.now()+60000},key);
    };
    tx.oncomplete=()=>resolve(acquired);tx.onerror=()=>reject(tx.error??new Error('Local dispatch transaction failed.'));tx.onabort=()=>reject(tx.error??new Error('Local dispatch transaction failed.'));
  });
}
function changeHolders(account:string,delta:number){
  const count=(holders.get(account)??0)+delta;
  if(count>0){holders.set(account,count);return count;}
  holders.delete(account);
  clearInterval(renewals.get(account));renewals.delete(account);
  return 0;
}
/** One account dispatcher across tabs, shared by this page's work; the lease expires after a crashed tab. */
export async function acquireAccountDispatch(account:string):Promise<(()=>Promise<void>)|undefined>{
  changeHolders(account,1);
  let acquired=false;
  try{acquired=await updateLease(account);}
  finally{if(!acquired)changeHolders(account,-1);}
  if(!acquired)return undefined;
  if(!renewals.has(account))renewals.set(account,setInterval(()=>{void updateLease(account).catch(()=>undefined);},10000));
  let released=false;
  return async()=>{
    if(released)return;
    released=true;
    if(changeHolders(account,-1)===0)await updateLease(account,true);
  };
}

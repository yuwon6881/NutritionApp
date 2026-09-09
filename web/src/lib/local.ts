import type { LocalData } from '../types';
let connection:Promise<IDBDatabase>|undefined;
function database(){return connection??=new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('nourish-local',1);request.onupgradeneeded=()=>request.result.createObjectStore('accounts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
export async function readLocal(user:string):Promise<LocalData|undefined>{const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('accounts').objectStore('accounts').get(user);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function saveLocal(user:string,data:LocalData){const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(data,user);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Local save aborted.'));});}

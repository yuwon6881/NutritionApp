import type {Mutation,MutationConflict} from '../types';
import {idbGet} from './idb';
import {extractLegacyMutationConflicts} from './mutationConflicts';

export type RetainedMutations={queue:Mutation[];conflicts:MutationConflict[]};
type StoredMutations={queue?:Mutation[];conflicts?:MutationConflict[]};

async function migrateLegacyMutationConflicts(db:IDBDatabase,user:string):Promise<RetainedMutations>{
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['mutations'],'readwrite');
    const store=tx.objectStore('mutations');
    let result:RetainedMutations={queue:[],conflicts:[]};
    const request=store.get(user);
    request.onsuccess=()=>{
      try{
        const saved=request.result as StoredMutations|undefined;
        const migrated=extractLegacyMutationConflicts(saved?.queue??[],saved?.conflicts??[],Date.now());
        result={queue:migrated.queue,conflicts:migrated.conflicts};
        store.put(result,user);
      }catch(error){
        try{tx.abort();}catch{/* already settled */}
        reject(error);
      }
    };
    request.onerror=()=>reject(request.error??new Error('Could not read retained mutations.'));
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error??new Error('Could not migrate retained conflicts.'));
    tx.onabort=()=>reject(tx.error??new Error('Retained conflict migration aborted.'));
  });
}

export async function readRetainedMutations(db:IDBDatabase,user:string):Promise<RetainedMutations>{
  const record=await idbGet<StoredMutations>(db,'mutations',user);
  const queue=record?.queue??[];
  const conflicts=record?.conflicts??[];
  const hasLegacyConflict=queue.some(mutation=>typeof (mutation as Mutation&{error?:unknown}).error==='string'&&
    ((mutation as Mutation&{error:string}).error).toLowerCase().includes('conflict'));
  return hasLegacyConflict?migrateLegacyMutationConflicts(db,user):{queue,conflicts};
}
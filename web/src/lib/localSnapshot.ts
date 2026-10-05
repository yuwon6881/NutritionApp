import type {LocalData} from '../types';
import {mergeRetained} from './retainedMerge';

/** Persist immutable partitions together, without cloning unchanged photo/food payloads. */
export async function writeLocalSnapshot(
  db: IDBDatabase, user: string, data: LocalData, previous?: LocalData, retireFoodBasketDate?: string
): Promise<void> {
  const accountChanged = !previous || data.state !== previous.state || data.progress !== previous.progress || data.foodsLoaded !== previous.foodsLoaded;
  const queueChanged = !previous || data.queue !== previous.queue;
  const draftsChanged = !previous || data.photoDrafts !== previous.photoDrafts || data.bodyDrafts !== previous.bodyDrafts;
  const foodsChanged = data.foodsLoaded !== false && (!previous || previous.foodsLoaded === false ||
    data.state.foods !== previous.state.foods || data.state.foodRevision !== previous.state.foodRevision);
  const stores: string[] = [];
  if (accountChanged) stores.push('accounts');
  if (queueChanged) stores.push('mutations');
  if (draftsChanged) stores.push('drafts');
  if (foodsChanged) stores.push('saved_foods');
  if (retireFoodBasketDate !== undefined) stores.push('food_drafts');
  if (!stores.length) return;
  await new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction | undefined;
    let failed=false;
    try {
      tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx?.error);
      tx.onabort = () => reject(tx?.error ?? new Error('Local data transaction aborted'));
      const guard=(action:()=>void)=>{if(failed)return;try{action();}catch(error){failed=true;try{tx?.abort();}catch{/* already settled */}reject(error);}};
      if (accountChanged) {
        // Saved foods are authoritative in their own partition. Empty fallbacks remain
        // readable by older clients without duplicating the large collection.
        const store=tx.objectStore('accounts');const request=store.get(user);
        request.onsuccess=()=>guard(()=>{
          if((request.result?.state?.revision??0)>data.state.revision)return;
          store.put({state:{...data.state,foods:[]},progress:data.progress,foodsLoaded:data.foodsLoaded},user);
        });
      }
      if (queueChanged) {
        const store=tx.objectStore('mutations');
        const request=store.get(user);
        request.onsuccess=()=>guard(()=>{
          data.queue=mergeRetained(request.result?.queue??previous?.queue??[],previous?.queue??[],data.queue,item=>item.id);
          store.put({queue:data.queue},user);
        });
      }
      if (draftsChanged) {
        const store=tx.objectStore('drafts');
        const request=store.get(user);
        request.onsuccess=()=>guard(()=>{
          const saved=request.result as Pick<LocalData,'photoDrafts'|'bodyDrafts'>|undefined;
          data.photoDrafts=mergeRetained(saved?.photoDrafts??previous?.photoDrafts??[],previous?.photoDrafts??[],data.photoDrafts??[],item=>item.versionId??item.id);
          data.bodyDrafts=mergeRetained(saved?.bodyDrafts??previous?.bodyDrafts??[],previous?.bodyDrafts??[],data.bodyDrafts??[],item=>item.mutationId);
          store.put({photoDrafts:data.photoDrafts,bodyDrafts:data.bodyDrafts},user);
        });
      }
      if(foodsChanged){
        const store=tx.objectStore('saved_foods');const request=store.get(user);
        request.onsuccess=()=>guard(()=>{
          const revision=data.state.foodRevision??data.state.revision??0;
          if((request.result?.revision??0)>revision)return;
          store.put({foods:data.state.foods,revision,fetchedAt:Date.now(),loaded:true},user);
        });
      }
      if (retireFoodBasketDate !== undefined) tx.objectStore('food_drafts').delete(`${user}:${retireFoodBasketDate}`);
    } catch (error) {
      // A synchronous structured-clone/quota failure must not commit preceding puts.
      try { tx?.abort(); } catch { /* Already settled. */ }
      reject(error);
    }
  });
}

/** Atomically remove legacy duplication only after its authoritative partition exists. */
export async function compactAccountSnapshot(db: IDBDatabase, user: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['accounts','saved_foods'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Account compaction aborted'));
    const accounts = tx.objectStore('accounts');
    const request = accounts.get(user);
    request.onsuccess = () => {
      const raw = request.result as LocalData | undefined;
      if (!raw?.state.foods.length) return;
      const foods = tx.objectStore('saved_foods');
      const foodRequest = foods.get(user);
      foodRequest.onsuccess = () => {
        if (!foodRequest.result) foods.put({foods:raw.state.foods,
          revision:raw.state.foodRevision ?? raw.state.revision,fetchedAt:Date.now(),loaded:true},user);
        accounts.put({...raw,state:{...raw.state,foods:[]}},user);
      };
    };
  });
}

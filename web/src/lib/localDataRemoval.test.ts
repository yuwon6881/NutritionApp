import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {
  clearUserCache,countAccountLocalWork,resetDatabaseConnectionForTests
} from './local';

type Values=Map<IDBValidKey,unknown>;

function fakeDatabase(initial:Record<string,Values>={}){
  const stores=new Map<string,Values>(Object.entries(initial));
  const ensure=(name:string)=>{
    let values=stores.get(name);
    if(!values){values=new Map();stores.set(name,values);}
    return values;
  };
  const request=<T,>(result:T)=>{
    const req={result,onsuccess:null as IDBRequest<T>['onsuccess'],onerror:null as IDBRequest<T>['onerror']};
    queueMicrotask(()=>req.onsuccess?.call(req as unknown as IDBRequest<T>,new Event('success')));
    return req as unknown as IDBRequest<T>;
  };
  const db={
    objectStoreNames:{contains:(name:string)=>stores.has(name)},
    createObjectStore:(name:string)=>{ensure(name);return {} as IDBObjectStore;},
    transaction:(names:string|string[])=>{
      const selected=typeof names==='string'?[names]:names;
      const tx={
        error:null as DOMException|null,
        oncomplete:null as IDBTransaction['oncomplete'],
        onerror:null as IDBTransaction['onerror'],
        onabort:null as IDBTransaction['onabort'],
        abort:()=>{},
        objectStore:(name:string)=>{
          if(!selected.includes(name))throw new Error(`Store ${name} is outside this transaction.`);
          const values=ensure(name);
          return {
            get:(key:IDBValidKey)=>request(values.get(key)),
            getAllKeys:()=>request([...values.keys()]),
            delete:(key:IDBValidKey)=>{values.delete(key);return request(undefined);},
            openCursor:()=>{
              const keys=[...values.keys()];
              let index=0;
              const cursorRequest={
                result:null as IDBCursorWithValue|null,
                onsuccess:null as IDBRequest<IDBCursorWithValue|null>['onsuccess'],
                onerror:null as IDBRequest<IDBCursorWithValue|null>['onerror']
              };
              const advance=()=>queueMicrotask(()=>{
                const key=keys[index];
                cursorRequest.result=key===undefined?null:{
                  key,
                  primaryKey:key,
                  value:values.get(key),
                  delete:()=>{values.delete(key);return request(undefined);},
                  continue:()=>{index++;advance();}
                } as unknown as IDBCursorWithValue;
                cursorRequest.onsuccess?.call(cursorRequest as unknown as IDBRequest<IDBCursorWithValue|null>,new Event('success'));
              });
              advance();
              return cursorRequest as unknown as IDBRequest<IDBCursorWithValue|null>;
            }
          } as unknown as IDBObjectStore;
        }
      };
      setTimeout(()=>tx.oncomplete?.call(tx as unknown as IDBTransaction,new Event('complete')),0);
      return tx as unknown as IDBTransaction;
    },
    close:()=>{},
    onversionchange:null as IDBDatabase['onversionchange']
  };
  return {db:db as unknown as IDBDatabase,stores};
}

function installDatabase(fake:ReturnType<typeof fakeDatabase>){
  vi.stubGlobal('indexedDB',{open:()=>{
    const request={
      result:fake.db,
      onblocked:null as IDBOpenDBRequest['onblocked'],
      onupgradeneeded:null as IDBOpenDBRequest['onupgradeneeded'],
      onsuccess:null as IDBOpenDBRequest['onsuccess'],
      onerror:null as IDBOpenDBRequest['onerror']
    };
    queueMicrotask(()=>{
      request.onupgradeneeded?.call(request as unknown as IDBOpenDBRequest,{oldVersion:0} as IDBVersionChangeEvent);
      request.onsuccess?.call(request as unknown as IDBOpenDBRequest,new Event('success'));
    });
    return request as unknown as IDBOpenDBRequest;
  }} as unknown as IDBFactory);
}

beforeEach(()=>resetDatabaseConnectionForTests());
afterEach(()=>{vi.unstubAllGlobals();resetDatabaseConnectionForTests();});

describe('account-local Nutrition data removal',()=>{
  it('counts only this account’s queued mutations and drafts',async()=>{
    const foodLine={key:'food-1',name:'Apple',source:'manual',quantity:1,unit:'serving',calories:95,protein:null,carbs:null,fat:null,fiber:null,portionLabel:null,portionGrams:null,portions:[]};
    const scan={version:1,id:'scan-a',date:'2026-09-22',mode:'photo',description:'',imageBase64:'base64',status:'captured'};
    const fake=fakeDatabase({
      accounts:new Map(),
      mutations:new Map([
        ['account-a',{queue:[{id:'a-1'},{id:'a-2'}]}],
        ['account-b',{queue:[{id:'b-1'}]}]
      ]),
      drafts:new Map([
        ['account-a',{photoDrafts:[{id:'photo-a'}],bodyDrafts:[{id:'body-a'},{id:'body-b'}]}],
        ['account-b',{photoDrafts:[{id:'photo-b'}],bodyDrafts:[]}]
      ]),
      food_drafts:new Map([
        ['account-a:2026-09-22',{version:1,lines:[foodLine]}],
        ['account-b:2026-09-22',{version:1,lines:[foodLine]}]
      ]),
      food_scans:new Map([
        ['account-a:2026-09-22',scan],
        ['account-b:2026-09-22',{...scan,id:'scan-b'}]
      ])
    });
    installDatabase(fake);

    await expect(countAccountLocalWork('account-a')).resolves.toEqual({
      outboxMutations:2,photoDrafts:1,bodyDrafts:2,foodBasketDrafts:1,scanDrafts:1,total:7
    });
  });

  it('removes only this account’s cache and keeps notification revocation work',async()=>{
    const accountA='account-a';
    const accountB='account-b';
    const fake=fakeDatabase({
      accounts:new Map([[accountA,{state:{id:accountA}}],[accountB,{state:{id:accountB}}]]),
      saved_foods:new Map([[accountA,{foods:['a']}],[accountB,{foods:['b']}]]),
      mutations:new Map([[accountA,{queue:['a']}],[accountB,{queue:['b']}]]),
      drafts:new Map([[accountA,{bodyDrafts:['a']}],[accountB,{bodyDrafts:['b']}]]),
      food_drafts:new Map([[`${accountA}:2026-09-22`,{lines:['a']}],[`${accountB}:2026-09-22`,{lines:['b']}]]),
      food_scans:new Map([[`${accountA}:2026-09-22`,{id:'a'}],[`${accountB}:2026-09-22`,{id:'b'}]]),
      diary_days:new Map([[`${accountA}:2026-09-22`,{date:'2026-09-22'}],[`${accountB}:2026-09-22`,{date:'2026-09-22'}]]),
      meta:new Map([[`migrated_v2:${accountA}`,true],[`migrated_v2:${accountB}`,true]]),
      push_revocations:new Map([['revocation-a',{userId:accountA,fcmToken:'token-a'}]]),
      push_devices:new Map([[`${accountA}:device-a`,{userId:accountA,fcmToken:'token-a'}]])
    });
    installDatabase(fake);

    await clearUserCache(accountA);

    for(const storeName of ['accounts','saved_foods','mutations','drafts','food_drafts','food_scans','diary_days','meta']){
      const store=fake.stores.get(storeName);
      const keys=[...store?.keys()??[]];
      const accountAKey=storeName==='meta'?`migrated_v2:${accountA}`:accountA;
      const accountBKey=storeName==='meta'?`migrated_v2:${accountB}`:accountB;
      expect(keys.some(key=>typeof key==='string'&&key.startsWith(accountAKey))).toBe(false);
      expect(keys.some(key=>typeof key==='string'&&key.startsWith(accountBKey))).toBe(true);
    }
    expect(fake.stores.get('push_revocations')?.has('revocation-a')).toBe(true);
    expect(fake.stores.get('push_devices')?.has(`${accountA}:device-a`)).toBe(true);
  });
});

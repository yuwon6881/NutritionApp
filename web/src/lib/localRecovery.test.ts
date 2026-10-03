import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {
  database,foodBasketDraftKey,resetDatabaseConnectionForTests,
  saveLocalAndRetireFoodBasketDraft
} from './local';
import type {LocalData} from '../types';

function fakeDatabase(){
  const stores=new Set<string>();
  const transactions:{stores:string[];actions:{store:string;kind:'put'|'delete';key?:IDBValidKey}[]}[]=[];
  let closed=false;
  const db={
    objectStoreNames:{contains:(name:string)=>stores.has(name)},
    createObjectStore:(name:string)=>{stores.add(name);return {} as IDBObjectStore;},
    transaction:(names:string|string[])=>{
      const selected=typeof names==='string'?[names]:names;
      const current={stores:selected,actions:[] as {store:string;kind:'put'|'delete';key?:IDBValidKey}[]};
      transactions.push(current);
      const tx={
        error:null,
        objectStore:(store:string)=>({
          put:(_value:unknown,key?:IDBValidKey)=>{current.actions.push({store,kind:'put',key});return {} as IDBRequest;},
          delete:(key:IDBValidKey)=>{current.actions.push({store,kind:'delete',key});return {} as IDBRequest;},
          get:(_key:IDBValidKey)=>{
            const request={result:undefined,onsuccess:null as IDBRequest['onsuccess'],onerror:null};
            queueMicrotask(()=>request.onsuccess?.call(request as unknown as IDBRequest,new Event('success')));
            return request as unknown as IDBRequest;
          }
        }),
        oncomplete:null as IDBTransaction['oncomplete'],
        onerror:null as IDBTransaction['onerror'],
        onabort:null as IDBTransaction['onabort']
      };
      queueMicrotask(()=>tx.oncomplete?.call(tx as unknown as IDBTransaction,new Event('complete')));
      return tx as unknown as IDBTransaction;
    },
    close:()=>{closed=true;},
    get closed(){return closed;},
    onversionchange:null as IDBDatabase['onversionchange']
  };
  return {db:db as unknown as IDBDatabase,transactions,stores};
}

function openWith(fake:ReturnType<typeof fakeDatabase>,blocked=false){
  const factory={open:()=>{
    const request={
      result:fake.db,
      onblocked:null as IDBOpenDBRequest['onblocked'],
      onupgradeneeded:null as IDBOpenDBRequest['onupgradeneeded'],
      onsuccess:null as IDBOpenDBRequest['onsuccess'],
      onerror:null as IDBOpenDBRequest['onerror']
    };
    queueMicrotask(()=>{
      if(blocked){
        request.onblocked?.call(request as unknown as IDBOpenDBRequest,new Event('blocked') as IDBVersionChangeEvent);
        return;
      }
      if(request.onupgradeneeded)request.onupgradeneeded.call(request as unknown as IDBOpenDBRequest,{oldVersion:0} as IDBVersionChangeEvent);
      request.onsuccess?.call(request as unknown as IDBOpenDBRequest,new Event('success'));
    });
    return request as unknown as IDBOpenDBRequest;
  }};
  vi.stubGlobal('indexedDB',factory as unknown as IDBFactory);
}

beforeEach(()=>{
  resetDatabaseConnectionForTests();
  vi.useFakeTimers();
});

afterEach(()=>{
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetDatabaseConnectionForTests();
});

describe('durable local recovery',()=>{
  it('retires a food-basket draft in the same transaction that writes its outbox snapshot',async()=>{
    const fake=fakeDatabase();
    openWith(fake);
    const data={
      state:{id:'account-a',displayName:'A',revision:3,profileRevision:1,profile:null,start:'2026-09-21',end:'2026-09-21',entries:[],foods:[],weights:[],days:[],plans:[]},
      queue:[{id:'operation-1',kind:'food-entry'}],
      photoDrafts:[],bodyDrafts:[],foodsLoaded:true
    } as unknown as LocalData;

    await saveLocalAndRetireFoodBasketDraft('account-a',data,'2026-09-21');

    // Opening the database reads its import marker; the save itself is one write transaction.
    const writes=fake.transactions.filter(transaction=>transaction.actions.length>0);
    expect(writes).toHaveLength(1);
    expect(writes[0].stores).toContain('mutations');
    expect(writes[0].stores).toContain('food_drafts');
    expect(writes[0].actions).toContainEqual({store:'mutations',kind:'put',key:'account-a'});
    expect(writes[0].actions).toContainEqual({
      store:'food_drafts',kind:'delete',key:foodBasketDraftKey('account-a','2026-09-21')
    });
  });

  it('reports a blocked IndexedDB upgrade after a bounded wait',async()=>{
    const fake=fakeDatabase();
    openWith(fake,true);
    const opening=database();
    await Promise.resolve();
    const assertion=expect(opening).rejects.toMatchObject({
      name:'LocalDatabaseError',code:'timeout',message:expect.stringContaining('blocked by another open tab')
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('closes the old database connection on versionchange and rejects writes until reload',async()=>{
    const fake=fakeDatabase();
    openWith(fake);
    const opened=await database();
    opened.onversionchange?.call(opened,new Event('versionchange') as IDBVersionChangeEvent);

    expect((fake.db as IDBDatabase&{closed:boolean}).closed).toBe(true);
    await expect(database()).rejects.toMatchObject({code:'versionchange'});
  });
});

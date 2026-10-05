import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

// A minimal in-memory stand-in for the IndexedDB `meta` store; requests settle asynchronously
// and transactions complete after their callbacks, as in the browser.
const rows=new Map<string,unknown>();
function fakeDatabase(){
  return {transaction:()=>{
    const tx:{oncomplete?:()=>void;onerror?:()=>void;onabort?:()=>void;error:null;objectStore:()=>unknown}={error:null,objectStore:()=>store};
    const store={
      get:(key:string)=>{
        const request:{result?:unknown;onsuccess?:()=>void}={};
        setTimeout(()=>{request.result=rows.get(key);request.onsuccess?.();setTimeout(()=>tx.oncomplete?.(),0);},0);
        return request;
      },
      put:(value:unknown,key:string)=>{rows.set(key,value);},
      delete:(key:string)=>{rows.delete(key);}
    };
    return tx;
  }};
}
vi.mock('./local',()=>({database:async()=>fakeDatabase()}));

describe('account dispatch lease',()=>{
  beforeEach(()=>{rows.clear();vi.resetModules();});
  afterEach(()=>vi.useRealTimers());

  it('lets concurrent work in the same page share the lease',async()=>{
    const {acquireAccountDispatch}=await import('./accountDispatch');
    // A wake starts the outbox drain and draft uploads together; neither may lock out the other.
    const [drain,drafts]=await Promise.all([acquireAccountDispatch('alice'),acquireAccountDispatch('alice')]);
    expect(drain).toBeDefined();
    expect(drafts).toBeDefined();
    await drain!();
    expect(rows.has('dispatch:alice')).toBe(true);
    await drafts!();
    expect(rows.has('dispatch:alice')).toBe(false);
  });

  it('refuses a live lease held by another page until it expires',async()=>{
    rows.set('dispatch:alice',{owner:'other-tab',until:Date.now()+60000});
    const {acquireAccountDispatch}=await import('./accountDispatch');
    expect(await acquireAccountDispatch('alice')).toBeUndefined();
    rows.set('dispatch:alice',{owner:'other-tab',until:Date.now()-1});
    const release=await acquireAccountDispatch('alice');
    expect(release).toBeDefined();
    await release!();
  });

  it('releasing twice does not drop a lease another holder still needs',async()=>{
    const {acquireAccountDispatch}=await import('./accountDispatch');
    const first=await acquireAccountDispatch('alice');
    const second=await acquireAccountDispatch('alice');
    await first!();
    await first!();
    expect(rows.has('dispatch:alice')).toBe(true);
    await second!();
    expect(rows.has('dispatch:alice')).toBe(false);
  });
});

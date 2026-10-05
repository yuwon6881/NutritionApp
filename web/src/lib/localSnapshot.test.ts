import {expect,it,vi} from 'vitest';
import {writeLocalSnapshot} from './localSnapshot';
import type {LocalData} from '../types';

const data:LocalData={state:{id:'a',displayName:'A',revision:1,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-01-02',entries:[],foods:[],weights:[],days:[],plans:[]},queue:[],foodsLoaded:true};
function database(fail=false){
  const put=vi.fn(()=>{if(fail)throw new Error('clone failed');});
  const remove=vi.fn();const abort=vi.fn();
  const transaction=vi.fn(()=>{
    const tx={oncomplete:null as null|(()=>void),onerror:null,onabort:null,error:null,objectStore:()=>({put,delete:remove,get:()=>{const r={result:undefined,onsuccess:null as null|(()=>void)};queueMicrotask(()=>r.onsuccess?.());return r;}}),abort};
    queueMicrotask(()=>queueMicrotask(()=>tx.oncomplete?.()));return tx;
  });
  return {db:{transaction} as unknown as IDBDatabase,transaction,put,remove,abort};
}
it('writes only the queue partition without cloning unchanged retained drafts',async()=>{
  const mock=database();await writeLocalSnapshot(mock.db,'a',{...data,queue:[{id:'m',kind:'weight',recordId:'w',expectedRevision:0,delete:false,data:{kg:80}}]},data);
  expect(mock.transaction).toHaveBeenCalledWith(['mutations'],'readwrite');
});
it('retires the basket in the same transaction as the queued mutation',async()=>{
  const mock=database();await writeLocalSnapshot(mock.db,'a',{...data,queue:[{id:'m',kind:'entry',recordId:'e',expectedRevision:0,delete:false,data:{}}]},data,'2026-01-01');
  expect(mock.transaction).toHaveBeenCalledWith(['mutations','food_drafts'],'readwrite');
  expect(mock.remove).toHaveBeenCalledWith('a:2026-01-01');
});
it('aborts synchronous write failures and performs no transaction for unchanged references',async()=>{
  const mock=database(true);await expect(writeLocalSnapshot(mock.db,'a',data)).rejects.toThrow('clone failed');
  expect(mock.abort).toHaveBeenCalledOnce();
  mock.transaction.mockClear();await writeLocalSnapshot(mock.db,'a',data,data);
  expect(mock.transaction).not.toHaveBeenCalled();
});

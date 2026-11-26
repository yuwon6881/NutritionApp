import {describe,expect,it} from 'vitest';
import type {AppState,Mutation} from '../types';
import {project,wireMutation} from './projection';
import {dispatchWait,nextDispatchableMutation,releaseHeldMutations,selectKeepaliveBatch,undoHeldMutations} from './heldMutations';

const state:AppState={id:'a',displayName:'a',revision:1,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-03-01',
  entries:[
    {id:'e',revision:3,deleted:false,date:'2026-02-01',name:'Rice',calories:130,protein:3,carbs:28,fat:0,fiber:null,source:'Manual',quantity:1,unit:'serving'},
    {id:'other',revision:3,deleted:false,date:'2026-02-01',name:'Tea',calories:2,protein:0,carbs:0,fat:0,fiber:null,source:'Manual',quantity:1,unit:'serving'},
  ],
  foods:[],weights:[],days:[],plans:[]};
const held=(id:string,holdUntil:number,recordId='e'):Mutation=>({id,kind:'entry',recordId,expectedRevision:3,delete:true,data:{...state.entries[0]},holdUntil});

describe('undoable (held) deletions',()=>{
  it('waits out the hold at the head of the queue',()=>{
    expect(dispatchWait([held('other',2000,'other')],1000)).toBe(1000);
  });
  it('project the deletion immediately while the request waits',()=>{
    expect(project(state,[held('m',2000)]).entries[0].deleted).toBe(true);
  });

  it('wait to dispatch until the undo window ends, and block later operations to keep order',()=>{
    const later:Mutation={id:'n',kind:'weight',recordId:'w',expectedRevision:0,delete:false,data:{}};
    expect(dispatchWait([held('m',2000),later],1000)).toBe(1000);
    expect(dispatchWait([held('m',2000),later],2000)).toBe(0);
    expect(dispatchWait([later],1000)).toBe(0);
    expect(dispatchWait([],1000)).toBe(0);
  });

  it('undo removes only still-held operations so the record and its id are untouched',()=>{
    const queue=[held('m',2000),held('x',2000,'other')];
    const result=undoHeldMutations(queue,['m'],1500);
    expect(result.undone).toEqual(['m']);
    expect(result.queue.map(op=>op.id)).toEqual(['x']);
    expect(project(state,result.queue).entries[0]).toMatchObject({id:'e',deleted:false,revision:3});
  });

  it('refuses to undo once the window has ended, because the request may already be sending',()=>{
    const queue=[held('m',2000)];
    const result=undoHeldMutations(queue,['m'],2000);
    expect(result.undone).toEqual([]);
    expect(result.queue).toBe(queue);
  });

  it('does not partially undo a batch when one operation is expired or missing',()=>{
    const queue=[held('m',2000),held('x',1000,'other')];
    expect(undoHeldMutations(queue,['m','x'],1500)).toEqual({queue,undone:[]});
    expect(undoHeldMutations(queue,['m','missing'],1500)).toEqual({queue,undone:[]});
  });

  it('preserves later edits that depend on an operation being undone',()=>{
    const move={...held('m',2000),delete:false,data:{...state.entries[0],date:'2026-02-02'}};
    const later={...move,id:'later',holdUntil:undefined,data:{...state.entries[0],date:'2026-02-02',calories:200}};
    const queue=[move,later];
    expect(undoHeldMutations(queue,['m'],1500)).toEqual({queue,undone:[]});
    expect(undoHeldMutations([move],['m'],1500).queue).toEqual([]);
  });

  it('never sends the local hold to the server',()=>{
    expect(wireMutation(held('m',2000))).not.toHaveProperty('holdUntil');
  });

  it('dispatches in queue order, retrying an edit an older build held for review', ()=>{
    const legacy={...held('m1',0,'rec-1'),error:'Invalid data (400)'} as Mutation;
    const later:Mutation={...held('m2',0,'rec-2')};
    expect(nextDispatchableMutation([legacy,later])).toBe(legacy);
    expect(nextDispatchableMutation([later])).toBe(later);
    expect(nextDispatchableMutation([])).toBeUndefined();
  });

  it('releases holds selectively or for the whole queue without mutating unheld items',()=>{
    const unheld:Mutation={id:'u',kind:'entry',recordId:'r2',expectedRevision:0,delete:false,data:{}};
    const unheldQueue=[unheld];
    const queue=[held('h1',5000,'r1'),unheld,held('h2',5000,'r3')];
    expect(releaseHeldMutations(unheldQueue)).toBe(unheldQueue);
    const single=releaseHeldMutations(queue,['h1']);
    expect(single[0].holdUntil).toBeUndefined();
    expect(single[1]).toBe(unheld);
    expect(single[2].holdUntil).toBe(5000);
    const all=releaseHeldMutations(queue);
    expect(all.every(item=>item.holdUntil===undefined)).toBe(true);
  });

  it('selects keepalive batches safely while respecting backoff, order, and byte caps',()=>{
    const create=(id:string,recordId:string,extra?:Partial<Mutation>):Mutation=>({
      id,kind:'entry',recordId,expectedRevision:0,delete:false,data:{name:'Food'},...extra
    });
    const a=create('a','r1',{holdUntil:99999});
    const b=create('b','r2',{holdUntil:99999});
    const edit={...create('c','r2'),expectedRevision:2};
    expect(selectKeepaliveBatch([a,b,edit],1000,new Set())).toEqual([a,b]);
    expect(selectKeepaliveBatch([a,b],1000,new Set(['a']))).toEqual([]);
    expect(selectKeepaliveBatch([create('wait','r1',{retryAt:5000}),b],1000,new Set())).toEqual([]);
    expect(selectKeepaliveBatch([create('big','r1',{data:{text:'x'.repeat(60000)}})],1000,new Set())).toEqual([]);
  });
});

import {describe,expect,it} from 'vitest';
import type {AppState,Mutation} from '../types';
import {project,wireMutation} from './projection';
import {dispatchWait,undoHeldMutations} from './heldMutations';

const state:AppState={id:'a',displayName:'a',revision:1,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-03-01',
  entries:[
    {id:'e',revision:3,deleted:false,date:'2026-02-01',name:'Rice',calories:130,protein:3,carbs:28,fat:0,fiber:null,source:'Manual',quantity:1,unit:'serving'},
    {id:'other',revision:3,deleted:false,date:'2026-02-01',name:'Tea',calories:2,protein:0,carbs:0,fat:0,fiber:null,source:'Manual',quantity:1,unit:'serving'},
  ],
  foods:[],weights:[],days:[],plans:[]};
const held=(id:string,holdUntil:number,recordId='e'):Mutation=>({id,kind:'entry',recordId,expectedRevision:3,delete:true,data:{...state.entries[0]},holdUntil});

describe('undoable (held) deletions',()=>{
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

  it('never sends the local hold to the server',()=>{
    expect(wireMutation(held('m',2000))).not.toHaveProperty('holdUntil');
  });
});

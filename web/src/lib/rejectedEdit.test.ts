import {describe,expect,it} from 'vitest';
import type {Mutation} from '../types';
import {rejectedEditMessage} from './rejectedEdit';

const op=(kind:Mutation['kind'],data:unknown):Mutation=>({id:'m',kind,recordId:'r',expectedRevision:0,delete:false,data});

describe('rejected edit notice',()=>{
  it('names the dropped day decision and says the saved version stayed',()=>{
    expect(rejectedEditMessage(op('day',{date:'2026-09-29',status:'not_logged'})))
      .toBe('Couldn’t apply the “Not logging” decision for 2026-09-29 from this device. The saved version was kept.');
  });
  it('names food entries and falls back when details are missing',()=>{
    expect(rejectedEditMessage(op('entry',{name:'Oats',date:'2026-09-28'}))).toContain('food entry “Oats” for 2026-09-28');
    expect(rejectedEditMessage(op('settings',null))).toContain('coaching settings change');
  });
});

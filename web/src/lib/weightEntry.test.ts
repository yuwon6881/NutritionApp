import {describe,expect,it} from 'vitest';
import type {Weight} from '../types';
import {weightEntryDirty,weightEntryValues} from './weightEntry';

const weight=(date:string,kg:number,deleted=false):Weight=>
  ({id:date,revision:1,deleted,date,kg}) as Weight;

describe('weigh-in dialog values',()=>{
  it('opens an untouched form that is not dirty against its own baseline',()=>{
    const opened=weightEntryValues(undefined,'2026-09-11',[],undefined,'kg');

    expect(opened).toEqual({date:'2026-09-11',kg:''});
    expect(weightEntryDirty(opened,opened)).toBe(false);
  });

  it('treats a prefilled date as part of the baseline rather than a user value',()=>{
    const opened=weightEntryValues('2026-09-04','2026-09-11',[],undefined,'kg');

    expect(opened.date).toBe('2026-09-04');
    expect(weightEntryDirty(opened,opened)).toBe(false);
    expect(weightEntryDirty({...opened,date:'2026-09-11'},opened)).toBe(true);
  });

  it('prefills an existing weigh-in in the display unit and stays clean',()=>{
    const weights=[weight('2026-09-11',80)];

    const opened=weightEntryValues(undefined,'2026-09-11',weights,undefined,'lb');

    expect(opened.kg).toBe('176.37');
    expect(weightEntryDirty(opened,opened)).toBe(false);
  });

  it('ignores a deleted weigh-in on the same date',()=>{
    const opened=weightEntryValues(undefined,'2026-09-11',[weight('2026-09-11',80,true)],undefined,'kg');

    expect(opened.kg).toBe('');
  });

  it('prefers the record being edited over the date lookup',()=>{
    const weights=[weight('2026-09-11',80)];

    const opened=weightEntryValues(undefined,'2026-09-11',weights,weight('2026-09-04',75),'kg');

    expect(opened).toEqual({date:'2026-09-04',kg:'75'});
  });

  it('reports a dirty form only once a field leaves its baseline',()=>{
    const opened=weightEntryValues(undefined,'2026-09-11',[],undefined,'kg');

    expect(weightEntryDirty({...opened,kg:'80'},opened)).toBe(true);
    expect(weightEntryDirty({...opened,kg:''},opened)).toBe(false);
  });
});

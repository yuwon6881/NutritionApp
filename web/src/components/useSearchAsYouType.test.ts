import {describe,expect,it} from 'vitest';
import {typeaheadQuery} from './useSearchAsYouType';

describe('search as you type',()=>{
  it('waits for at least three characters and trims whitespace',()=>{
    expect(typeaheadQuery('eg')).toBeNull();
    expect(typeaheadQuery('  egg  ')).toBe('egg');
  });

  it('never sends a query longer than the server accepts',()=>{
    expect(typeaheadQuery('a'.repeat(101))).toBeNull();
    expect(typeaheadQuery('a'.repeat(100))).toHaveLength(100);
  });
});

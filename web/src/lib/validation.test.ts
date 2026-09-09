import {expect,it} from 'vitest';
import {constraintMessage} from './validation';
const control=(value:string,flags:Partial<ValidityState>={},extra:Record<string,unknown>={})=>({value,validity:{valid:true,...flags} as ValidityState,...extra});
it('rejects whitespace names but preserves optional unknowns and numeric zero',()=>{
  expect(constraintMessage(control('  ',{},{required:true}),'Food name')).toBe('Enter food name.');
  expect(constraintMessage(control(''),'Protein')).toBe('');
  expect(constraintMessage(control('0',{},{required:true}),'Calories')).toBe('');
});
it('checks programmatically supplied password lengths',()=>{
  expect(constraintMessage(control('short',{},{minLength:12}),'Password')).toBe('Use at least 12 characters.');
});
it('provides application messages for invalid numbers, bounds, steps and dates',()=>{
  expect(constraintMessage(control('',{badInput:true}),'Weight')).toBe('Enter a valid number.');
  expect(constraintMessage(control('10',{rangeUnderflow:true},{min:'20'}),'Weight')).toBe('Enter 20 or more.');
  expect(constraintMessage(control('2027-01-01',{rangeOverflow:true},{type:'date',max:'2026-09-09'}),'Date')).toBe('Choose 2026-09-09 or earlier.');
  expect(constraintMessage(control('1.5',{stepMismatch:true},{step:'1'}),'Weeks')).toBe('Use increments of 1.');
});

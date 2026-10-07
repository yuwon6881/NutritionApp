import {describe,expect,it} from 'vitest';
import type {Entry} from '../types';
import {recentFoodSections} from './recentFoodSections';

let id=0;
function entry(name:string,date:string,time:string|null):Entry{
  id+=1;
  return {id:`e${id}`,revision:1,name,date,time,calories:100,protein:5,carbs:10,fat:2,fiber:null,source:'Manual',quantity:1,unit:'serving'} as Entry;
}

const breakfast={date:'2026-09-26',minutes:8*60};

describe('recent food sections',()=>{
  it('lists foods logged around this time on several days, then the latest others',()=>{
    const {aroundNow,latest}=recentFoodSections([
      entry('Oats','2026-09-24','07:45'),entry('Oats','2026-09-25','08:20'),
      entry('Coffee','2026-09-20','09:00'),entry('Coffee','2026-09-22','07:00'),
      entry('Pizza','2026-09-25','20:00'),
      // A single breakfast is not yet a habit.
      entry('Pancakes','2026-09-23','08:00'),
    ],breakfast);
    expect(aroundNow.map(item=>item.name)).toEqual(['Oats','Coffee']);
    expect(latest.map(item=>item.name)).toEqual(['Pizza','Pancakes']);
  });

  it('weights recent days above old ones and ignores entries beyond four weeks',()=>{
    const {aroundNow}=recentFoodSections([
      entry('Old habit','2026-09-01','08:00'),entry('Old habit','2026-09-02','08:00'),entry('Old habit','2026-09-03','08:00'),
      entry('New habit','2026-09-24','08:00'),entry('New habit','2026-09-25','08:00'),
      entry('Expired','2026-08-01','08:00'),entry('Expired','2026-08-02','08:00'),
    ],breakfast);
    expect(aroundNow.map(item=>item.name)).toEqual(['New habit','Old habit']);
  });

  it('counts a day once, wraps around midnight, and caps each section',()=>{
    const late={date:'2026-09-26',minutes:23*60+50};
    const {aroundNow}=recentFoodSections([
      entry('Tea','2026-09-24','00:20'),entry('Tea','2026-09-25','23:30'),
      entry('Snack','2026-09-25','23:00'),entry('Snack','2026-09-25','23:40'),
    ],late);
    expect(aroundNow.map(item=>item.name)).toEqual(['Tea']);
    const many=Array.from({length:14},(_,index)=>entry(`Food ${index}`,`2026-09-${String(10+index).padStart(2,'0')}`,'12:00'));
    expect(recentFoodSections(many,breakfast).latest).toHaveLength(10);
  });

  it('shows each food once with its latest portion',()=>{
    const {aroundNow,latest}=recentFoodSections([
      entry('Oats','2026-09-24','08:00'),entry('oats ','2026-09-25','08:00'),
    ],breakfast);
    expect(aroundNow).toHaveLength(1);
    expect(aroundNow[0].date).toBe('2026-09-25');
    expect(latest).toHaveLength(0);
  });
});

import {describe,expect,it} from 'vitest';
import type {Entry} from '../types';
import {lineFromEntry,rankRecentFoods} from './recentFoods';

let id=0;
function entry(name:string,date:string,time:string|null,extra:Partial<Entry>={}):Entry{
  id+=1;
  return {id:`e${id}`,revision:1,name,date,time,calories:100,protein:5,carbs:10,fat:2,fiber:null,source:'Manual',quantity:1,unit:'serving',...extra} as Entry;
}

const morning={date:'2026-09-26',minutes:8*60};

describe('recent foods',()=>{
  it('represents each food by its latest entry so re-logging repeats the last portion',()=>{
    const ranked=rankRecentFoods([
      entry('Oats','2026-09-20','08:00',{quantity:40,unit:'g'}),
      entry('oats ','2026-09-25','08:10',{quantity:60,unit:'g'}),
    ],morning);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({date:'2026-09-25',quantity:60});
  });

  it('ranks foods eaten often and at this time of day above one-off foods',()=>{
    const entries=[
      entry('Pizza','2026-09-25','20:00'),
      ...['2026-09-19','2026-09-21','2026-09-23','2026-09-24'].map(date=>entry('Oats',date,'08:00')),
      entry('Coffee','2026-09-24','08:05'),
    ];
    const names=rankRecentFoods(entries,morning).map(item=>item.name);
    expect(names[0]).toBe('Oats');
    expect(names.indexOf('Coffee')).toBeLessThan(names.indexOf('Pizza'));
  });

  it('ignores deleted entries and future-dated entries, and honours the limit',()=>{
    const entries=[
      entry('Deleted','2026-09-25','08:00',{deleted:true}),
      entry('Tomorrow','2026-09-27','08:00'),
      ...Array.from({length:12},(_,index)=>entry(`Food ${index}`,'2026-09-2'+(index%6),'12:00')),
    ];
    const ranked=rankRecentFoods(entries,morning,8);
    expect(ranked).toHaveLength(8);
    expect(ranked.map(item=>item.name)).not.toContain('Deleted');
    expect(ranked.map(item=>item.name)).not.toContain('Tomorrow');
  });

  it('treats times near midnight as close to each other',()=>{
    const late={date:'2026-09-26',minutes:23*60+50};
    const names=rankRecentFoods([entry('Tea','2026-09-20','00:10'),entry('Lunch','2026-09-20','12:00')],late).map(item=>item.name);
    expect(names[0]).toBe('Tea');
  });

  it('builds a batch line with the exact logged portion and unknown nutrients kept unknown',()=>{
    const line=lineFromEntry(entry('Rice','2026-09-25','13:00',{quantity:1.5,unit:'serving',portionLabel:'cup',portionGrams:158,fiber:null}));
    expect(line).toMatchObject({name:'Rice',quantity:1.5,unit:'serving',portionLabel:'cup',portionGrams:158,fiber:null,portions:[{label:'cup',grams:158}]});
    expect(line.key.startsWith('Manual|rice_')).toBe(true);
  });
});

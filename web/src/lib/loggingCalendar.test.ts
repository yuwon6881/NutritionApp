import {describe,expect,it} from 'vitest';
import type {AppState,Entry} from '../types';
import {calendarDates,calendarMonths,foodCalendar,summarizeCalendar,weekdayIndex,weightCalendar} from './loggingCalendar';

const entry=(date:string,deleted=false)=>({id:`e-${date}`,revision:0,deleted,date,name:'Oats',calories:300,protein:10,carbs:50,fat:5,quantity:1,unit:'serving'}) as Entry;

function state(overrides:Partial<AppState>={}):AppState{
  return {id:'u',displayName:'u',revision:0,profileRevision:0,foods:[],profile:null,plans:[],
    start:'2026-09-01',end:'2026-09-10',entries:[],weights:[],days:[],...overrides} as AppState;
}

const status=(cells:{date:string;status:string}[])=>Object.fromEntries(cells.map(cell=>[cell.date,cell.status]));

describe('logging calendar',()=>{
  it('lists dates oldest first ending on the given day',()=>{
    expect(calendarDates('2026-09-10',3)).toEqual(['2026-09-08','2026-09-09','2026-09-10']);
    expect(weekdayIndex('2026-09-07')).toBe(0);
    expect(weekdayIndex('2026-09-13')).toBe(6);
  });

  it('marks food, explicit decisions, missed days, today, and dates not on the device',()=>{
    const cells=foodCalendar(state({
      entries:[entry('2026-09-05'),entry('2026-09-06',true)],
      days:[
        {id:'d1',revision:0,deleted:false,date:'2026-09-07',status:'fasting'},
        {id:'d2',revision:0,deleted:false,date:'2026-09-08',status:'not_logged'},
        {id:'d3',revision:0,deleted:false,date:'2026-09-04',status:'complete',archived:true,entryCount:3},
      ],
    }),'2026-09-10','2026-09-11',9);
    expect(status(cells)).toEqual({
      '2026-09-03':'before',
      '2026-09-04':'logged',
      '2026-09-05':'logged',
      '2026-09-06':'missing',
      '2026-09-07':'fasting',
      '2026-09-08':'not_logged',
      '2026-09-09':'missing',
      '2026-09-10':'open',
      '2026-09-11':'future',
    });
    expect(foodCalendar(state(),'2026-09-10','2026-08-31',1)[0].status).toBe('unknown');
  });

  it('marks weigh-ins, days before the first one, and never calls an unloaded day missing',()=>{
    const cells=weightCalendar(state({weights:[
      {id:'w1',revision:0,deleted:false,date:'2026-09-09',kg:80},
      {id:'w2',revision:0,deleted:true,date:'2026-09-08',kg:80},
    ]}),'2026-09-10','2026-09-10',12);
    expect(status(cells)['2026-08-30']).toBe('unknown');
    expect(status(cells)['2026-09-08']).toBe('before');
    expect(status(cells)['2026-09-09']).toBe('logged');
    expect(status(cells)['2026-09-10']).toBe('missing');
  });

  it('lays out whole months newest first under Monday-based weekdays',()=>{
    const months=calendarMonths('2026-08-20','2026-09-10');
    expect(months.map(month=>month.month)).toEqual(['2026-09','2026-08']);
    expect(months[0]).toMatchObject({leading:1,dates:expect.arrayContaining(['2026-09-01','2026-09-30'])});
    expect(months[0].dates).toHaveLength(30);
    expect(months[1].leading).toBe(5);
    expect(months[1].dates).toHaveLength(31);
    expect(calendarMonths('2026-12-15','2027-01-02').map(month=>month.month)).toEqual(['2027-01','2026-12']);
  });

  it('counts kept days and a streak that waits for today',()=>{
    const cells=[
      {date:'2026-09-06',status:'missing'},
      {date:'2026-09-07',status:'logged'},
      {date:'2026-09-08',status:'fasting'},
      {date:'2026-09-09',status:'logged'},
      {date:'2026-09-10',status:'open'},
      {date:'2026-09-11',status:'future'},
    ];
    expect(summarizeCalendar(cells,'2026-09-10')).toEqual({logged:3,known:4,streak:3});
    cells[4].status='logged';
    expect(summarizeCalendar(cells,'2026-09-10')).toEqual({logged:4,known:5,streak:4});
    expect(summarizeCalendar([{date:'2026-09-09',status:'not_logged'},{date:'2026-09-10',status:'logged'}],'2026-09-10').streak).toBe(1);
    expect(summarizeCalendar([{date:'2026-09-10',status:'unknown'}],'2026-09-10')).toEqual({logged:0,known:0,streak:0});
    expect(summarizeCalendar([{date:'2026-09-09',status:'before'},{date:'2026-09-10',status:'logged'}],'2026-09-10')).toEqual({logged:1,known:1,streak:1});
  });

  it('treats a new account as starting at its first record, and older weigh-ins as history',()=>{
    expect(status(foodCalendar(state(),'2026-09-10','2026-09-10',3))).toEqual({'2026-09-08':'before','2026-09-09':'before','2026-09-10':'open'});
    const seeded=state({weightTrendSeed:[{id:'s',revision:0,deleted:false,date:'2026-08-20',kg:81}],weights:[{id:'w',revision:0,deleted:false,date:'2026-09-09',kg:80}]});
    expect(status(weightCalendar(seeded,'2026-09-10','2026-09-02',2))).toEqual({'2026-09-01':'missing','2026-09-02':'missing'});
  });
});

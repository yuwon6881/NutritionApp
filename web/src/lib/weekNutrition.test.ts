import {describe,expect,it} from 'vitest';
import type {AppState,Day,Entry,Plan} from '../types';
import {targetShare,weekAverage,weekNutrition} from './weekNutrition';

const entry=(date:string,calories:number,macros:Partial<Pick<Entry,'protein'|'carbs'|'fat'>>={},deleted=false)=>
  ({id:`e-${date}-${calories}`,revision:0,deleted,date,name:'Oats',calories,protein:10,carbs:50,fat:5,quantity:1,unit:'serving',...macros}) as Entry;
const day=(date:string,overrides:Partial<Day>)=>({id:`d-${date}`,revision:0,deleted:false,date,status:'incomplete',...overrides}) as Day;
const plan=(date:string)=>({id:'p',revision:1,deleted:false,date,inputRevision:1,profileRevision:1,
  resultJson:JSON.stringify({eligible:true,adaptive:false,calories:2000,expenditure:2200,protein:150,carbs:200,fat:60,explanation:'',version:'2.0.0'})}) as Plan;

function state(overrides:Partial<AppState>={}):AppState{
  return {id:'u',displayName:'u',revision:0,profileRevision:0,foods:[],profile:null,plans:[plan('2026-09-01')],
    start:'2026-09-01',end:'2026-09-30',entries:[],weights:[],days:[],...overrides} as AppState;
}

describe('week nutrition',()=>{
  // 2026-09-10 is a Thursday; its week runs Monday 7th through Sunday 13th.
  const current='2026-09-10';

  it('covers the Monday-based week with known, missing, today and future days',()=>{
    const week=weekNutrition(state({
      entries:[entry('2026-09-07',1800),entry('2026-09-07',200,{},true)],
      days:[day('2026-09-08',{status:'fasting'}),day('2026-09-09',{status:'not_logged'})],
    }),current);
    expect(week.map(item=>item.date)).toEqual(['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13']);
    expect(week.map(item=>item.status)).toEqual(['known','known','missing','known','future','future','future']);
    expect(week[0].intake).toEqual({calories:1800,protein:10,carbs:50,fat:5});
    // A fasting day is an explicit zero; a not-logging day stays unknown, never zero.
    expect(week[1].intake.calories).toBe(0);
    expect(week[2].intake.calories).toBeNull();
    // Today with nothing yet logged is an open zero.
    expect(week[3].intake.calories).toBe(0);
    expect(week[0].target).toEqual({calories:2000,protein:150,carbs:200,fat:60});
  });

  it('keeps unknown nutrients unknown and marks partial sums',()=>{
    const [monday]=weekNutrition(state({entries:[entry('2026-09-07',500,{protein:null}),entry('2026-09-07',300,{protein:20,fat:null,carbs:null}),entry('2026-09-07',100,{fat:null,carbs:null})]}),current);
    expect(monday.intake.protein).toBe(30);
    expect(monday.partial.protein).toBe(true);
    expect(monday.intake.fat).toBe(5);
    expect(monday.partial.fat).toBe(true);
    const [only]=weekNutrition(state({entries:[entry('2026-09-07',500,{protein:null})]}),current);
    expect(only.intake.protein).toBeNull();
    expect(only.partial.protein).toBe(false);
  });

  it('reads archived day totals and leaves dates off the device unknown',()=>{
    const week=weekNutrition(state({start:'2026-09-08',days:[day('2026-09-08',{archived:true,entryCount:2,calories:1500,protein:90,carbs:null,fat:40})]}),current);
    expect(week[0].status).toBe('unknown');
    expect(week[1]).toMatchObject({status:'known',intake:{calories:1500,protein:90,carbs:null,fat:40}});
  });

  it('has no targets before the first accepted plan',()=>{
    const [monday,tuesday]=weekNutrition(state({plans:[plan('2026-09-08')],entries:[entry('2026-09-07',900)]}),current);
    expect(monday.target).toEqual({calories:null,protein:null,carbs:null,fat:null});
    expect(tuesday.target.calories).toBe(2000);
  });

  it('hides calorie targets that a due check-in may change',()=>{
    const week=weekNutrition(state({entries:[entry('2026-09-07',1800),entry('2026-09-10',400)]}),current,current);
    expect(week[0].target.calories).toBe(2000);
    expect(week[3].target).toEqual({calories:null,protein:150,carbs:200,fat:60});
    expect(week[6].target.calories).toBeNull();
  });

  it('averages past days with intake evidence and leaves today out',()=>{
    const week=weekNutrition(state({entries:[entry('2026-09-07',1800),entry('2026-09-08',2200),entry('2026-09-10',400)]}),current);
    const average=weekAverage(week,current);
    expect(average.days).toBe(2);
    expect(average.intake.calories).toBe(2000);
    expect(average.target.calories).toBe(2000);
    expect(weekAverage(weekNutrition(state(),'2026-09-07'),'2026-09-07')).toMatchObject({days:0,intake:{calories:null}});
  });

  it('caps target shares and keeps unknown shares unknown',()=>{
    expect(targetShare(500,2000)).toBe(.25);
    expect(targetShare(2500,2000)).toBe(1);
    expect(targetShare(null,2000)).toBeNull();
    expect(targetShare(500,null)).toBeNull();
    expect(targetShare(500,0)).toBeNull();
  });
});

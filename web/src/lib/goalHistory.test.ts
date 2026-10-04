import {describe,expect,it} from 'vitest';
import type {Plan} from '../types';
import {buildGoalHistory} from './goalHistory';

const plan=(id:string,date:string,goal:string,startWeight:number,scaleWeight:number,trendWeight:number,complete=false):Plan=>({
  id,revision:1,deleted:false,date,inputRevision:1,profileRevision:1,
  resultJson:JSON.stringify({calories:1800,phaseComplete:complete,effectiveGoal:goal,goalProgress:{goal,startWeight,scaleWeight,trendWeight,complete}})
});

describe('goal history',()=>{
  it('reports one entry per goal with start and latest weight, newest first',()=>{
    const history=buildGoalHistory([
      plan('c','2026-10-02','lose',64,63.2,63.5),
      plan('b','2026-09-08','lose',64,63.8,63.9),
      plan('a','2026-08-01','maintain',66,66,66)
    ]);
    expect(history).toEqual([
      {startDate:'2026-09-08',goal:'lose',startKg:64,endKg:63.2,status:'active'},
      {startDate:'2026-08-01',goal:'maintain',startKg:66,endKg:66,status:'changed',endDate:'2026-09-08'}
    ]);
  });

  it('uses the trend weight when that is the goal metric',()=>{
    const [entry]=buildGoalHistory([plan('a','2026-09-08','lose',64,63.2,63.5)],'trend');
    expect(entry.endKg).toBe(63.5);
  });

  it('marks a completed goal with its completion date',()=>{
    const [entry]=buildGoalHistory([plan('b','2026-10-02','lose',64,60,60.2,true),plan('a','2026-09-08','lose',64,62,62.1)]);
    expect(entry).toMatchObject({status:'completed',endDate:'2026-10-02',endKg:60});
  });

  it('keeps unknown weights absent and skips unreadable plans',()=>{
    const broken:Plan={...plan('x','2026-09-01','lose',64,1,1),resultJson:'{'};
    const empty:Plan={...plan('y','2026-09-02','lose',64,1,1),resultJson:JSON.stringify({effectiveGoal:'lose'})};
    expect(buildGoalHistory([empty,broken])).toEqual([{startDate:'2026-09-02',goal:'lose',startKg:null,endKg:null,status:'active'}]);
  });
});

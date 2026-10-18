import {describe,expect,it} from 'vitest';
import {changeSincePrevious,latestWeighIns} from './weighInList';
import type {Weight} from '../types';

const series=[{date:'2026-09-20',scaleKg:81,trendKg:81},{date:'2026-09-22',scaleKg:80.6,trendKg:80.9},{date:'2026-09-25',scaleKg:80.9,trendKg:80.8}];

describe('weigh-in change',()=>{
  it('compares with the closest earlier weigh-in',()=>{
    expect(changeSincePrevious(series,'2026-09-25',80.9)).toBeCloseTo(.3);
    expect(changeSincePrevious(series,'2026-09-23',80.2)).toBeCloseTo(-.4);
  });

  it('is unknown for the first weigh-in in the period',()=>{
    expect(changeSincePrevious(series,'2026-09-20',81)).toBeNull();
    expect(changeSincePrevious([],'2026-09-20',81)).toBeNull();
  });

  it('efficiently handles large datasets spanning years',()=>{
    // 3,650 days (10 years) of daily weigh-in data
    const largeSeries=Array.from({length:3650},(_,i)=>{
      const d=new Date(Date.UTC(2016,0,1+i));
      const date=d.toISOString().slice(0,10);
      return {date,scaleKg:70+Math.sin(i/50)*5,trendKg:70};
    });
    const targetDate=largeSeries[largeSeries.length-1].date;
    const pointBefore=largeSeries[largeSeries.length-2];
    expect(pointBefore).toBeDefined();

    const start=performance.now();
    for(let k=0;k<100;k++){
      const change=changeSincePrevious(largeSeries,targetDate,75);
      expect(change).toBeCloseTo(75-pointBefore.scaleKg);
    }
    const elapsed=performance.now()-start;
    // 100 binary searches across 3,650 items should take well under 10ms
    expect(elapsed).toBeLessThan(50);
  });
});

describe('latest weigh-ins',()=>{
  const weight=(date:string,kg:number,deleted=false)=>({id:date,revision:1,deleted,date,kg}) as Weight;

  it('lists the newest weigh-ins first, up to the count',()=>{
    const weights=[weight('2026-10-14',81.2),weight('2026-10-17',81),weight('2026-10-16',80.9),weight('2026-10-15',81.1)];
    expect(latestWeighIns(weights,'2026-10-18',3).map(item=>item.date)).toEqual(['2026-10-17','2026-10-16','2026-10-15']);
  });

  it('leaves out deleted and future weigh-ins',()=>{
    const weights=[weight('2026-10-19',80),weight('2026-10-18',81,true),weight('2026-10-17',81)];
    expect(latestWeighIns(weights,'2026-10-18',3).map(item=>item.date)).toEqual(['2026-10-17']);
  });

  it('is empty without weigh-ins',()=>{
    expect(latestWeighIns([],'2026-10-18',3)).toEqual([]);
  });
});

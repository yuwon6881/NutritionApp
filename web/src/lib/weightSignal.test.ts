import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import type {WeightContextCode} from '../types';
import {weightContextRules} from './weightContext';
import {cleanTrend,countedWeighIns,outlierDates,unusualWeighIn,weightSignalPolicy,type SignalPoint} from './weightSignal';

type Fixture={
  policy:Record<string,number>;
  contexts:{code:string;label:string;direction:string;temporary:boolean;settleDays:number}[];
  trendCases:{today:string;weights:SignalPoint[];excludedDates:string[];outlierDates:string[];finalTrendKg:number}[];
};
const fixture=JSON.parse(readFileSync(new URL('../../../tests/fixtures/weight-context.json',import.meta.url),'utf8')) as Fixture;

const day=(offset:number)=>new Date(Date.UTC(2026,7,11)+offset*86400000).toISOString().slice(0,10);
const series=(value:(index:number)=>number,context?:(index:number)=>WeightContextCode|undefined)=>
  Array.from({length:28},(_,index)=>({date:day(index),kg:value(index),context:context?.(index)??null}));

describe('shared weigh-in context contract',()=>{
  it('mirrors the fixture rules and policy the server also matches',()=>{
    expect(weightContextRules).toEqual(fixture.contexts);
    expect(weightSignalPolicy).toEqual(fixture.policy);
  });

  it('produces the same exclusions, outliers, and trend as the server for each parity case',()=>{
    for(const item of fixture.trendCases){
      const counted=countedWeighIns(item.weights).map(point=>point.date);
      const clean=cleanTrend(item.weights,item.today);
      expect(item.weights.map(point=>point.date).filter(date=>!counted.includes(date))).toEqual(item.excludedDates);
      expect(counted.filter(date=>!clean.some(point=>point.date===date))).toEqual(item.outlierDates);
      expect(clean.at(-1)?.kg).toBeCloseTo(item.finalTrendKg,9);
    }
  });
});

describe('clean weight trend',()=>{
  it('keeps a spike out of the trend while the raw scale value stays in history',()=>{
    const weights=series(index=>index===24?82.5:80);
    expect([...outlierDates(weights,day(28))]).toEqual([day(24)]);
    expect(cleanTrend(weights,day(28)).at(-1)?.kg).toBe(80);
  });

  it('keeps a genuine level shift',()=>{
    const weights=series(index=>index<14?80:78.8);
    expect(outlierDates(weights,day(28)).size).toBe(0);
    expect(cleanTrend(weights,day(28)).at(-1)?.kg).toBeLessThan(79.2);
  });

  it('counts a marked day again once later weigh-ins confirm the level',()=>{
    const weights=series(index=>index<14?80:81.2,index=>index===14?'stress':undefined);
    expect(countedWeighIns(weights).some(point=>point.date===day(14))).toBe(true);
  });

  it('keeps a recent marked day out until later weigh-ins exist',()=>{
    const weights=series(index=>index===26?81.6:80,index=>index===26?'stress':undefined);
    expect(countedWeighIns(weights).some(point=>point.date===day(26))).toBe(false);
  });
});

describe('unusual weigh-in baseline',()=>{
  const weigh=(date:string,kg:number,context:WeightContextCode|null=null)=>({id:date,revision:1,deleted:false,date,kg,context});

  it('leaves unconfirmed marked bloating days out of the expected weight',()=>{
    // Four bloated mornings would otherwise set the expected weight to 82.5 kg and read a normal return as a drop.
    const weights=[
      weigh('2026-09-04',80),weigh('2026-09-05',80),
      weigh('2026-09-06',82.5,'bloating'),weigh('2026-09-07',82.5,'bloating'),
      weigh('2026-09-08',82.5,'bloating'),weigh('2026-09-09',82.5,'bloating'),
      weigh('2026-09-10',80),
    ];

    expect(unusualWeighIn('80','kg','2026-09-11',weights)).toBeNull();
    expect(unusualWeighIn('82','kg','2026-09-11',weights)?.direction).toBe('up');
  });

  it('ignores deleted weigh-ins and the record being edited',()=>{
    const weights=[weigh('2026-09-04',80),weigh('2026-09-06',80),weigh('2026-09-08',80),{...weigh('2026-09-09',90),deleted:true}];

    expect(unusualWeighIn('82','kg','2026-09-11',weights)?.expectedKg).toBe(80);
    expect(unusualWeighIn('82','kg','2026-09-11',weights,'2026-09-08')).toBeNull();
  });
});

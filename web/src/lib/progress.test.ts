import {describe,expect,it} from 'vitest';
import {progressPeriodOptions,progressRange,projectProgressWeightSummary,projectedProgressRange} from './progress';
import type {Mutation,ProgressWeightSummary,Weight} from '../types';

describe('progress periods',()=>{
  it('keeps all five selectors aligned and defaults to the calendar month',()=>{
    expect(progressPeriodOptions.map(option=>option.label)).toEqual(['Last week','Last month','Last 6 months','One year','All']);
    expect(progressRange('month','2026-03-31')).toEqual({start:'2026-03-01',end:'2026-03-31'});
    expect(progressRange('week','2026-03-31')).toEqual({start:'2026-03-25',end:'2026-03-31'});
  });

  it('uses the profile-local end date and the earliest retained record for All',()=>{
    expect(progressRange('six-months','2026-03-31')).toEqual({start:'2025-10-01',end:'2026-03-31'});
    expect(progressRange('year','2026-03-31')).toEqual({start:'2025-04-01',end:'2026-03-31'});
    expect(progressRange('all','2026-03-31','1990-01-01')).toEqual({start:'2000-01-01',end:'2026-03-31'});
  });
});

describe('projectProgressWeightSummary',()=>{
  const range={start:'2026-03-01',end:'2026-03-31'};
  const baseSummary:ProgressWeightSummary={
    statistics:{
      count:2,
      averageKg:80,
      minimumKg:79.5,
      maximumKg:80.5,
      firstKg:79.5,
      latestKg:80.5,
      latestTrendKg:80.2,
      trendChangeKg:0.4
    },
    series:[
      {date:'2026-03-10',scaleKg:79.5,trendKg:80.0},
      {date:'2026-03-20',scaleKg:80.5,trendKg:80.2}
    ],
    editableWeighIns:[
      {id:'w2',date:'2026-03-20',kg:80.5,revision:1,deleted:false},
      {id:'w1',date:'2026-03-10',kg:79.5,revision:1,deleted:false}
    ]
  };

  it('returns base unchanged when queue is empty',()=>{
    expect(projectProgressWeightSummary(range,baseSummary,[])).toBe(baseSummary);
  });

  it('preserves acknowledged edits and deletions until the ranged summary refreshes',()=>{
    const acknowledged={...baseSummary.editableWeighIns[1],kg:78,revision:2};
    const edited=projectProgressWeightSummary(range,baseSummary,[],[acknowledged])!;
    expect(edited.series[0]).toEqual({date:acknowledged.date,scaleKg:78,trendKg:null});
    expect(edited.series[1].trendKg).toBeNull();
    const deleted=projectProgressWeightSummary(range,baseSummary,[],[{...acknowledged,deleted:true}])!;
    expect(deleted.series).toEqual([{date:'2026-03-20',scaleKg:80.5,trendKg:null}]);
    expect(projectProgressWeightSummary(range,baseSummary,[],[{...acknowledged,revision:0}])).toBe(baseSummary);
  });

  it('merges queued additions and marks trend pending',()=>{
    const addOp:Mutation={
      id:'m-add',
      kind:'weight',
      recordId:'w3',
      expectedRevision:0,
      delete:false,
      data:{date:'2026-03-25',kg:81}
    };
    const projected=projectProgressWeightSummary(range,baseSummary,[addOp])!;
    expect(projected).toBeDefined();
    expect(projected.statistics.count).toBe(3);
    expect(projected.statistics.latestKg).toBe(81);
    expect(projected.statistics.averageKg).toBeCloseTo((79.5+80.5+81)/3);
    expect(projected.statistics.maximumKg).toBe(81);
    expect(projected.statistics.trendPending).toBe(true);
    expect(projected.statistics.latestTrendKg).toBeNull();
    expect(projected.series).toHaveLength(3);
    expect(projected.series[2]).toEqual({date:'2026-03-25',scaleKg:81,trendKg:null});
    expect(projected.editableWeighIns[0].id).toBe('w3');
  });

  it('merges queued edits and recalculates extrema',()=>{
    const editOp:Mutation={
      id:'m-edit',
      kind:'weight',
      recordId:'w1',
      expectedRevision:1,
      delete:false,
      data:{date:'2026-03-10',kg:78}
    };
    const projected=projectProgressWeightSummary(range,baseSummary,[editOp])!;
    expect(projected.statistics.minimumKg).toBe(78);
    expect(projected.statistics.firstKg).toBe(78);
    expect(projected.statistics.trendPending).toBe(true);
    expect(projected.series[0].scaleKg).toBe(78);
  });

  it('merges queued moves and updates the series date',()=>{
    const moveOp:Mutation={
      id:'m-move',
      kind:'weight',
      recordId:'w2',
      expectedRevision:1,
      delete:false,
      data:{date:'2026-03-22',kg:80.5}
    };
    const projected=projectProgressWeightSummary(range,baseSummary,[moveOp])!;
    expect(projected.series.map(p=>p.date)).toEqual(['2026-03-10','2026-03-22']);
    expect(projected.editableWeighIns[0].date).toBe('2026-03-22');
  });

  it('merges queued deletions and removes items from series and editable list',()=>{
    const delOp:Mutation={
      id:'m-del',
      kind:'weight',
      recordId:'w2',
      expectedRevision:1,
      delete:true,
      data:{}
    };
    const projected=projectProgressWeightSummary(range,baseSummary,[delOp])!;
    expect(projected.statistics.count).toBe(1);
    expect(projected.statistics.averageKg).toBe(79.5);
    expect(projected.series).toHaveLength(1);
    expect(projected.series[0].date).toBe('2026-03-10');
    expect(projected.editableWeighIns).toHaveLength(1);
    expect(projected.editableWeighIns[0].id).toBe('w1');
  });

  it('synthesizes a summary when base is missing but retained weights exist',()=>{
    const retainedWeights:Weight[]=[
      {id:'rw1',date:'2026-03-05',kg:79,revision:1,deleted:false},
      {id:'rw2',date:'2026-03-15',kg:80,revision:1,deleted:false},
      {id:'rw3',date:'2026-02-15',kg:75,revision:1,deleted:false} // out of range
    ];
    const projected=projectProgressWeightSummary(range,undefined,[],retainedWeights)!;
    expect(projected).toBeDefined();
    expect(projected.historyUnavailable).toBe(true);
    expect(projected.statistics.count).toBe(2);
    expect(projected.statistics.averageKg).toBe(79.5);
    expect(projected.statistics.trendPending).toBe(true);
    expect(projected.series).toHaveLength(2);
  });

  it('returns undefined when base is missing and no retained weights exist',()=>{
    expect(projectProgressWeightSummary(range,undefined,[])).toBeUndefined();
  });
});

it('preserves cached All history and advances the profile-local day',()=>{
  const weights:Weight[]=[{id:'w',date:'2026-03-10',kg:80,revision:1,deleted:false}];
  const cached={start:'2025-01-01',end:'2026-03-31'};
  expect(projectedProgressRange('all','2026-04-01',cached,weights,[])).toEqual({start:'2025-01-01',end:'2026-04-01'});
  expect(projectedProgressRange('all','2026-04-01',undefined,weights,[]).start).toBe('2026-03-10');
  expect(projectedProgressRange('week','2026-04-01',cached,weights,[]).start).toBe('2026-03-26');
});

it('invalidates downstream trends after edits and restores them after Undo',()=>{
  const weight:Weight={id:'w',date:'2026-03-10',kg:80,revision:1,deleted:false};
  const base:ProgressWeightSummary={statistics:{count:2,averageKg:80,minimumKg:80,maximumKg:80,firstKg:80,latestKg:80,latestTrendKg:80,trendChangeKg:0},series:[{date:'2026-03-10',scaleKg:80,trendKg:80},{date:'2026-03-20',scaleKg:80,trendKg:80}],editableWeighIns:[weight]};
  const range={start:'2026-03-01',end:'2026-03-31'};
  const op:Mutation={id:'m',kind:'weight',recordId:'w',expectedRevision:1,delete:false,data:{date:weight.date,kg:81}};
  const edited=projectProgressWeightSummary(range,base,[op])!;
  expect(edited.series.every(point=>point.trendKg===null)).toBe(true);
  expect(projectProgressWeightSummary(range,base,[])).toBe(base);
  const deleted=projectProgressWeightSummary(range,base,[{...op,delete:true}])!;
  expect(deleted.series).toEqual([{date:'2026-03-20',scaleKg:80,trendKg:null}]);
  const offline=projectProgressWeightSummary(range,undefined,[op],[weight])!;
  expect(offline.series).toEqual([{date:'2026-03-10',scaleKg:81,trendKg:null}]);
});

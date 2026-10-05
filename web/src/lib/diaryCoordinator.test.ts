import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiaryCoordinator, getMonthRange } from './diaryCoordinator';
import type { DatedDiaryDay, Entry, Mutation } from '../types';
import {apiWithMeta} from './api';
import {saveDatedDiaryBatch} from './local';

vi.mock('./api',()=>({apiWithMeta:vi.fn()}));
vi.mock('./local',()=>({readDatedDiary:vi.fn(),clearUserCache:vi.fn(),saveDatedDiaryBatch:vi.fn().mockResolvedValue(undefined)}));

describe('DiaryCoordinator', () => {
  let coordinator: DiaryCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    coordinator = new DiaryCoordinator('user-1');
  });

  it('preserves pending explicit decisions and archived nutrient totals',()=>{
    coordinator.primeDays([{date:'2026-09-10',entries:[],revision:1,fetchedAt:0}]);
    const op:Mutation={id:'m',kind:'day',recordId:'d',expectedRevision:0,delete:false,data:{date:'2026-09-10',status:'fasting'}};
    expect(coordinator.projectDate('2026-09-10',[op])?.day?.status).toBe('fasting');
    coordinator.primeDays([{date:'2026-09-10',entries:[],day:{id:'d',date:'2026-09-10',status:'complete',archived:true,calories:1234,entryCount:2,protein:null,revision:1,deleted:false},revision:1,fetchedAt:0}]);
    expect(coordinator.projectDate('2026-09-10',[{...op,data:{date:'2026-09-10',status:'not_logged'}}])?.day).toMatchObject({status:'not_logged',calories:1234,entryCount:2,protein:null});
  });

  it('applies a later explicit decision after an entry change in queue order',()=>{
    coordinator.primeDays([{date:'2026-09-10',entries:[],day:{id:'d',date:'2026-09-10',status:'incomplete',revision:1,deleted:false},revision:1,fetchedAt:0}]);
    const change:Mutation={id:'delete',kind:'entry',recordId:'e',expectedRevision:1,delete:true,data:{date:'2026-09-10'}};
    const decision:Mutation={id:'decision',kind:'day',recordId:'d',expectedRevision:1,delete:false,data:{date:'2026-09-10',status:'fasting'}};
    expect(coordinator.projectDate('2026-09-10',[change,decision])?.day?.status).toBe('fasting');
    expect(coordinator.projectDate('2026-09-10',[decision,change])?.day?.status).toBe('incomplete');
  });

  it('shares a pending same-month navigation without aborting it',async()=>{
    let release:()=>void=()=>{};
    const held=new Promise<void>(resolve=>{release=resolve;});
    let signal:AbortSignal|undefined;
    vi.mocked(apiWithMeta).mockImplementationOnce(async(_path,options)=>{
      signal=options?.signal;await held;
      return {data:{entries:[],days:[],revision:2},notModified:false,etag:null};
    });
    const first=coordinator.requestDate('2026-09-10','2026-09-19',{isNavigation:true});
    const second=coordinator.requestDate('2026-09-11','2026-09-19',{isNavigation:true});
    expect(signal?.aborted).toBe(false);release();await Promise.all([first,second]);
    expect(apiWithMeta).toHaveBeenCalledOnce();
    expect(coordinator.getCached('2026-09-11')).toBeDefined();
  });

  it('caches empty dates throughout the bounded response and notifies other visible dates',async()=>{
    vi.mocked(apiWithMeta).mockResolvedValueOnce({data:{entries:[],days:[],revision:3},notModified:false,etag:'range'});
    const notified=vi.fn();
    coordinator.subscribe(notified);
    await coordinator.requestDate('2026-09-19','2026-09-19');
    expect(coordinator.getCached('2026-09-01')?.entries).toEqual([]);
    expect(coordinator.getCached('2026-09-18')?.entries).toEqual([]);
    expect(coordinator.getCached('2026-09-20')).toBeUndefined();
    expect(notified).toHaveBeenCalledWith(undefined);
  });

  it('ignores an old account background response after switching accounts',async()=>{
    let release:()=>void=()=>{};
    const held=new Promise<void>(resolve=>{release=resolve;});
    vi.mocked(apiWithMeta).mockImplementationOnce(async()=>{
      await held;
      return {data:{entries:[],days:[],revision:3},notModified:false,etag:null};
    });
    const request=coordinator.requestDate('2026-09-19','2026-09-19');
    coordinator.setUser('user-2');
    release();
    await request;
    expect(coordinator.getCached('2026-09-19')).toBeUndefined();
    expect(saveDatedDiaryBatch).not.toHaveBeenCalled();
  });

  it('calculates calendar month ranges correctly', () => {
    const r1 = getMonthRange('2026-09-18', '2026-09-19');
    expect(r1.from).toBe('2026-09-01');
    expect(r1.to).toBe('2026-09-19'); // clipped to maxDate

    const r2 = getMonthRange('2026-02-10', '2026-09-19');
    expect(r2.from).toBe('2026-02-01');
    expect(r2.to).toBe('2026-02-28');
  });

  it('reports freshness correctly: 30s for today, 5m for past dates', () => {
    const today = '2026-09-19';
    const past = '2026-09-10';

    const now = Date.now();
    coordinator.primeDays([
      { date: today, entries: [], revision: 1, fetchedAt: now - 10_000 },
      { date: past, entries: [], revision: 1, fetchedAt: now - 60_000 }
    ]);

    expect(coordinator.isFresh(today, today)).toBe(true);
    expect(coordinator.isFresh(past, today)).toBe(true);

    // Stale today (>30s)
    coordinator.primeDays([{ date: today, entries: [], revision: 1, fetchedAt: now - 35_000 }]);
    expect(coordinator.isFresh(today, today)).toBe(false);

    // Stale past date (>5m)
    coordinator.primeDays([{ date: past, entries: [], revision: 1, fetchedAt: now - 305_000 }]);
    expect(coordinator.isFresh(past, today)).toBe(false);
  });

  it('projects move mutations immediately across both source and destination dates', () => {
    const dateA = '2026-09-10';
    const dateB = '2026-09-11';

    const entry1: Entry = {
      id: 'entry-1',
      date: dateA,
      time: '12:00',
      name: 'Rice',
      calories: 200,
      quantity: 1,
      unit: 'serving',
      protein: 4,
      carbs: 45,
      fat: 1,
      fiber: 1,
      source: 'manual',
      revision: 1,
      deleted: false
    };

    coordinator.primeDays([
      { date: dateA, entries: [entry1], day: { id: 'd-a', date: dateA, status: 'complete', revision: 1, deleted: false }, revision: 1, fetchedAt: Date.now() },
      { date: dateB, entries: [], day: { id: 'd-b', date: dateB, status: 'complete', revision: 1, deleted: false }, revision: 1, fetchedAt: Date.now() }
    ]);

    // Move entry-1 to dateB
    const moveQueue: Mutation[] = [
      {
        id: 'm-1',
        kind: 'entry',
        recordId: 'entry-1',
        expectedRevision: 1,
        delete: false,
        data: { ...entry1, date: dateB, time: '13:00' }
      }
    ];

    const projectedA = coordinator.projectDate(dateA, moveQueue);
    expect(projectedA?.entries).toHaveLength(0);
    expect(projectedA?.day?.status).toBe('incomplete');

    const projectedB = coordinator.projectDate(dateB, moveQueue);
    expect(projectedB?.entries).toHaveLength(1);
    expect(projectedB?.entries[0].date).toBe(dateB);
    expect(projectedB?.entries[0].time).toBe('13:00');
    expect(projectedB?.day?.status).toBe('incomplete');
  });

  it('drops stale responses with an older revision than cached data', () => {
    coordinator.primeDays([
      { date: '2026-09-18', entries: [{ id: 'e1', date: '2026-09-18', name: 'Newer', calories: 100, quantity: 1, unit: 'g', source: 'm', revision: 5, deleted: false, protein: null, carbs: null, fat: null, fiber: null }], revision: 5, fetchedAt: Date.now() }
    ]);

    // An incoming day with revision 3 must not overwrite revision 5
    const existing = coordinator.getCached('2026-09-18');
    expect(existing?.revision).toBe(5);
  });

  it('resets completely on account switch', () => {
    coordinator.primeDays([
      { date: '2026-09-18', entries: [], revision: 1, fetchedAt: Date.now() }
    ]);
    expect(coordinator.getCached('2026-09-18')).toBeDefined();

    coordinator.setUser('user-2');
    expect(coordinator.getCached('2026-09-18')).toBeUndefined();
  });
  it('retains an acknowledged entry and move after the outbox clears',async()=>{
    const entry:Entry={id:'entry',date:'2026-09-18',name:'Oats',calories:500,quantity:100,unit:'g',source:'manual',revision:1,deleted:false,protein:null,carbs:null,fat:null,fiber:null};
    const op:Mutation={id:'add',kind:'entry',recordId:entry.id,expectedRevision:0,delete:false,data:entry};
    await coordinator.acknowledge(op,5);
    expect(coordinator.projectDate(entry.date,[])?.entries[0]).toMatchObject({calories:500,revision:5});
    await coordinator.acknowledge({...op,id:'move',expectedRevision:5,data:{...entry,date:'2026-09-19'}},6);
    expect(coordinator.projectDate('2026-09-18',[])?.entries).toEqual([]);
    expect(coordinator.projectDate('2026-09-19',[])?.entries[0]).toMatchObject({calories:500,revision:6});
  });
});

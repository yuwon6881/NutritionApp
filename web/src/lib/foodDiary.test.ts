import {afterEach,expect,it,vi} from 'vitest';
import type {AppState,Entry,LocalData,Mutation} from '../types';
import {mealReadOnly,mealTime,timelineGroups,timelineSlots,normalizeTime,moveTargets,moveEntry,moveAnnouncement,dropTarget} from './foodDiary';
import {project} from './projection';
import {acknowledgeHistory,historyState} from './history';

const state:AppState={id:'a',displayName:'a',revision:1,profileRevision:0,profile:null,start:'2026-06-12',end:'2026-09-09',entries:[],foods:[],weights:[],days:[],plans:[],detailDays:90};
const entry=(id:string,time?:string|null):Entry=>({id,time,date:'2026-09-09',name:'Quick add',quantity:1,unit:'serving',calories:300,protein:null,carbs:null,fat:null,fiber:null,source:'Quick add',revision:0,deleted:false});
afterEach(()=>vi.useRealTimers());

it('orders occupied times and separates legacy entries',()=>{
  const groups=timelineGroups([entry('late','23:59'),entry('old'),entry('noon','12:00'),entry('midnight','00:00')]);
  expect(groups.map(g=>g.label)).toEqual(['12 AM','12 PM','11:59 PM','Time not recorded']);
  expect(groups.map(g=>g.entries[0].id)).toEqual(['midnight','noon','late','old']);
});
it('does not insert a phantom midnight row when no entry exists at 00:00',()=>{
  const groups=timelineGroups([entry('morning','08:00'),entry('lunch','12:30')]);
  expect(groups.map(g=>g.time)).toEqual(['08:00','12:30']);
});
it('adds hourly drop slots while preserving exact occupied times',()=>{
  const groups=timelineSlots([entry('late','23:45'),entry('breakfast','08:30')],6,10);
  expect(groups.map(group=>group.time)).toEqual(['06:00','07:00','08:00','08:30','09:00','10:00','23:45']);
  expect(groups.find(group=>group.time==='08:30')?.entries[0].id).toBe('breakfast');
});
it('switches between occupied hours and the complete midnight-to-11pm day',()=>{
  const entries=[entry('breakfast','08:30'),entry('late','23:45'),entry('untimed')];
  expect(timelineSlots(entries,0,23,'data').map(group=>group.time)).toEqual(['08:30','23:45','']);
  const full=timelineSlots(entries,0,23,'full');
  expect(full[0].time).toBe('00:00');
  expect(full.at(-2)?.time).toBe('23:45');
  expect(full.at(-1)?.time).toBe('');
  expect(full.filter(group=>group.time).length).toBe(26);
});
it('uses the profile time zone and keeps already archived days read-only',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-08T16:05:00Z'));
  expect(mealTime('Asia/Kuala_Lumpur')).toBe('00:05');
  expect(mealReadOnly(state,'2026-06-12')).toBe(false);
  expect(mealReadOnly(state,'2026-06-11')).toBe(true);
  expect(mealReadOnly({...state,days:[{id:'d',date:'2026-09-01',archived:true,status:'complete',revision:1,deleted:false}]},'2026-09-01')).toBe(true);
});
it('projects retained quick adds into cached days without replacing the main window',()=>{
  const food=entry('e','09:00');
  const op:Mutation={id:'m',recordId:'e',kind:'entry',expectedRevision:0,delete:false,data:food};
  const local:LocalData={state,queue:[op]};
  const selected=historyState(local,'2026-09-09')!;
  expect(selected.entries).toEqual([food]);expect(selected.start).toBe('2026-09-09');
  expect(state.entries).toEqual([]);expect(state.start).toBe('2026-06-12');
  const saved=acknowledgeHistory(state,op,2);
  expect(saved.entries[0].revision).toBe(2);expect(saved.entries[0].protein).toBeNull();
  expect(saved.entries[0].time).toBe('09:00');
});
it('distinguishes missing cache coverage and rejects another account cache',()=>{
  const local:LocalData={state,queue:[],history:{'2025':{...state,id:'other',start:'2025-01-01',end:'2025-12-31'}}};
  expect(historyState(local,'2025')).toBeUndefined();
  expect(historyState(local,'2026-09-09')?.entries).toEqual([]);
});
it('selects fresher covered history and retains archived unknown totals',()=>{
  const archived:AppState={...state,revision:2,days:[{id:'d',date:'2026-09-01',archived:true,calories:450,protein:null,entryCount:1,status:'complete',revision:2,deleted:false}]};
  const local:LocalData={state,queue:[],history:{recent:archived}};
  const selected=historyState(local,'2026-09-01')!;
  expect(selected.days[0].calories).toBe(450);expect(selected.days[0].protein).toBeNull();
});
it('retains a conflicting entry edit without projecting it over an archived summary',()=>{
  const archived:AppState={...state,days:[{id:'d',date:'2026-09-09',archived:true,calories:450,entryCount:1,status:'not_logged',revision:2,deleted:false}]};
  const op:Mutation={id:'m',recordId:'e',kind:'entry',expectedRevision:0,delete:false,data:entry('e','12:00'),error:'Already summarized'};
  const local:LocalData={state:archived,queue:[op]};
  const selected=historyState(local,'2026-09-09')!;
  expect(selected.entries).toEqual([]);expect(selected.days[0].status).toBe('not_logged');
  expect(selected.days[0].calories).toBe(450);expect(local.queue).toEqual([op]);
});

it('normalizes time matching server rules', () => {
  expect(normalizeTime('')).toBeNull();
  expect(normalizeTime(null)).toBeNull();
  expect(normalizeTime(undefined)).toBeNull();
  expect(normalizeTime('00:00')).toBe('00:00');
  expect(normalizeTime('23:59')).toBe('23:59');
  expect(normalizeTime('12:30')).toBe('12:30');
  // Rejections matching server theory cases
  expect(normalizeTime('  ')).toBeUndefined();
  expect(normalizeTime('24:00')).toBeUndefined();
  expect(normalizeTime('12:60')).toBeUndefined();
  expect(normalizeTime('9:00')).toBeUndefined();
  expect(normalizeTime('12:00\n')).toBeUndefined();
  expect(normalizeTime('invalid')).toBeUndefined();
});

it('builds move targets excluding untimed group and flagging current time', () => {
  const groups = timelineGroups([entry('1', '08:00'), entry('2', '12:00'), entry('3', null)]);
  const targets = moveTargets(groups, '08:00');
  expect(targets.some(t => t.time === '')).toBe(false);
  expect(targets.find(t => t.time === '08:00')?.current).toBe(true);
  expect(targets.find(t => t.time === '12:00')?.current).toBe(false);
  expect(targets.find(t => t.time === '00:00')).toBeUndefined();
});

it('moveEntry returns undefined for no-op and preserves all entry data for moves', () => {
  const e = entry('item-1', '08:00');
  expect(moveEntry(e, '08:00')).toBeUndefined();
  const moved = moveEntry(e, '14:00');
  expect(moved).toBeDefined();
  expect(moved?.kind).toBe('entry');
  expect(moved?.recordId).toBe('item-1');
  expect(moved?.expectedRevision).toBe(0);
  expect(moved?.delete).toBe(false);
  const data = moved?.data as Entry;
  expect(data.time).toBe('14:00');
  expect(data.date).toBe(e.date);
  expect(data.name).toBe('Quick add');
  expect(data.calories).toBe(300);
});

it('moveEntry can move an entry to another editable date without dropping its snapshot', () => {
  const e = entry('item-2', '08:00');
  const moved = moveEntry(e, '09:30', '2026-09-08');
  expect(moved).toBeDefined();
  const data = moved?.data as Entry;
  expect(data.date).toBe('2026-09-08');
  expect(data.time).toBe('09:30');
  expect(data.protein).toBeNull();
  expect(data.source).toBe('Quick add');
});

it('formats move announcements for single and multiple entries', () => {
  expect(moveAnnouncement(1, '08:00')).toBe('Moved 1 entry to 8 AM.');
  expect(moveAnnouncement(3, '13:45')).toBe('Moved 3 entries to 1:45 PM.');
  expect(moveAnnouncement(2, null)).toBe('Moved 2 entries to Time not recorded.');
});

it('dropTarget clamps boundaries and selects closest row', () => {
  const rows = [
    {time: '08:00', top: 100, bottom: 200},
    {time: '12:00', top: 220, bottom: 320},
    {time: '18:00', top: 340, bottom: 440},
  ];
  expect(dropTarget([], 150)).toBeUndefined();
  // Above first clamped
  expect(dropTarget(rows, 50)).toBe('08:00');
  // Inside first
  expect(dropTarget(rows, 150)).toBe('08:00');
  // In gap between first and second, closer to first
  expect(dropTarget(rows, 205)).toBe('08:00');
  // In gap between first and second, closer to second
  expect(dropTarget(rows, 215)).toBe('12:00');
  // Inside third
  expect(dropTarget(rows, 400)).toBe('18:00');
  // Below last clamped
  expect(dropTarget(rows, 600)).toBe('18:00');
});

it('projects moved entry into newly created timeline row', () => {
  const initial = entry('item-1', '08:00');
  const op = moveEntry(initial, '15:30')!;
  const nextState = {
    ...state,
    entries: [initial],
  };
  const projected = project(nextState, [{...op, id: 'm-1'}]);
  const groups = timelineGroups(projected.entries);
  const row1530 = groups.find(g => g.time === '15:30');
  expect(row1530).toBeDefined();
  expect(row1530?.entries[0].id).toBe('item-1');
  expect(groups.find(g => g.time === '08:00')).toBeUndefined();
});

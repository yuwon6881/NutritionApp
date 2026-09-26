import type {Mutation, ProgressPeriod, ProgressWeightPoint, ProgressWeightStatistics, ProgressWeightSummary, Weight} from '../types';
import {shiftDate} from './energyBalance';

export const progressPeriodOptions:readonly {value:ProgressPeriod;label:string}[]=[
  {value:'week',label:'Last week'},
  {value:'month',label:'Last month'},
  {value:'six-months',label:'Last 6 months'},
  {value:'year',label:'One year'},
  {value:'all',label:'All'},
];

function calendarShift(date:string,months:number){
  const source=new Date(`${date}T00:00:00Z`);
  const day=source.getUTCDate();
  const shifted=new Date(Date.UTC(source.getUTCFullYear(),source.getUTCMonth()+months,1));
  const last=new Date(Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth()+1,0)).getUTCDate();
  shifted.setUTCDate(Math.min(day,last));
  return shifted.toISOString().slice(0,10);
}

export function progressRange(period:ProgressPeriod,today:string,earliest?:string){
  const start=period==='week'?shiftDate(today,-6)
    :period==='month'?shiftDate(calendarShift(today,-1),1)
    :period==='six-months'?shiftDate(calendarShift(today,-6),1)
    :period==='year'?shiftDate(calendarShift(today,-12),1)
    :earliest??today;
  return {start:start<'2000-01-01'?'2000-01-01':start,end:today};
}

export function progressPeriodLabel(period:ProgressPeriod){
  return progressPeriodOptions.find(option=>option.value===period)?.label??'Last month';
}

export function projectedProgressRange(
  period: ProgressPeriod,
  localToday: string,
  cached: {start: string; end: string} | undefined,
  weights: readonly Weight[],
  queue: readonly Mutation[]
) {
  const dates = [cached?.start, ...weights.filter(w => !w.deleted).map(w => w.date),
    ...queue.filter(op => op.kind === 'weight' && !op.delete).map(op => (op.data as Partial<Weight>).date)]
    .filter((date): date is string => typeof date === 'string' && date <= localToday);
  const earliest = dates.sort()[0];
  return progressRange(period, localToday, earliest);
}

/** Pure projection helper that merges queued weigh-in additions, edits, moves, and deletions
 *  into the selected period's recorded-weight series and editable list. */
export function projectProgressWeightSummary(
  range: { start: string; end: string },
  base: ProgressWeightSummary | undefined,
  queue: readonly Mutation[],
  retainedWeights?: readonly Weight[]
): ProgressWeightSummary | undefined {
  const weightMutations = queue.filter(op => op.kind === 'weight');

  if (!base) {
    const localWeights = new Map((retainedWeights ?? []).map(weight => [weight.id, weight]));
    for (const op of weightMutations) {
      const existing = localWeights.get(op.recordId);
      if (op.delete) localWeights.delete(op.recordId);
      else {
        const data = op.data as Partial<Weight>;
        const date = data.date ?? existing?.date;
        const kg = data.kg ?? existing?.kg;
        if (date && kg !== undefined) localWeights.set(op.recordId, {...existing, ...data, id:op.recordId, date, kg, revision:op.expectedRevision, deleted:false});
      }
    }
    const periodWeights = [...localWeights.values()]
      .filter(w => !w.deleted && w.date >= range.start && w.date <= range.end)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (periodWeights.length === 0) return undefined;

    const scaleValues = periodWeights.map(w => w.kg);
    const count = scaleValues.length;
    const series: ProgressWeightPoint[] = periodWeights.map(w => ({
      date: w.date,
      scaleKg: w.kg,
      trendKg: null
    }));
    const stats: ProgressWeightStatistics = {
      count,
      averageKg: count > 0 ? scaleValues.reduce((s, v) => s + v, 0) / count : null,
      minimumKg: count > 0 ? Math.min(...scaleValues) : null,
      maximumKg: count > 0 ? Math.max(...scaleValues) : null,
      firstKg: scaleValues[0] ?? null,
      latestKg: scaleValues[scaleValues.length - 1] ?? null,
      latestTrendKg: null,
      trendChangeKg: null,
      trendPending: true
    };
    const editableWeighIns = [...periodWeights].reverse();
    return {
      statistics: stats,
      series,
      editableWeighIns,
      historyUnavailable: true
    };
  }

  const editableMap = new Map<string, Weight>(base.editableWeighIns.map(w => [w.id, { ...w }]));
  const seriesMap = new Map<string, { scaleKg: number; trendKg: number|null }>(base.series.map(p => [p.date, { scaleKg: p.scaleKg, trendKg: p.trendKg }]));
  let affectedFrom: string | undefined;
  const invalidateFrom = (date: string | undefined) => {
    if (date && date <= range.end && (!affectedFrom || date < affectedFrom)) affectedFrom = date;
  };

  let hasRetainedAdditions = false;
  if (retainedWeights) {
    for (const rw of retainedWeights) {
      const existing = editableMap.get(rw.id);
      // An acknowledgement can retire the queue before the ranged summary refresh completes.
      // Keep that newer recorded value visible without overwriting a newer server summary.
      if (existing && rw.revision >= existing.revision &&
          (rw.deleted || existing.date !== rw.date || existing.kg !== rw.kg)) {
        invalidateFrom(existing.date);
        if (rw.deleted || existing.date !== rw.date) seriesMap.delete(existing.date);
        if (rw.deleted) editableMap.delete(rw.id);
        else {
          invalidateFrom(rw.date);
          seriesMap.set(rw.date, {scaleKg:rw.kg, trendKg:null});
          editableMap.set(rw.id, {...rw});
        }
        hasRetainedAdditions = true;
      }
      if (!rw.deleted && rw.date >= range.start && rw.date <= range.end) {
        if (!seriesMap.has(rw.date)) {
          seriesMap.set(rw.date, { scaleKg: rw.kg, trendKg: null });
          invalidateFrom(rw.date);
          hasRetainedAdditions = true;
        }
        if (!editableMap.has(rw.id)) {
          editableMap.set(rw.id, { ...rw });
          hasRetainedAdditions = true;
        }
      }
    }
  }

  if (weightMutations.length === 0 && !hasRetainedAdditions && base.series.every(p => p.date >= range.start && p.date <= range.end)) return base;

  for (const op of weightMutations) {
    const data = op.data as Partial<Weight>;
    if (op.delete) {
      const existing = editableMap.get(op.recordId);
      const targetDate = data.date ?? existing?.date;
      invalidateFrom(targetDate);
      if (targetDate) seriesMap.delete(targetDate);
      editableMap.delete(op.recordId);
    } else {
      const existing = editableMap.get(op.recordId);
      if (existing && data.date && existing.date !== data.date) {
        invalidateFrom(existing.date);
        seriesMap.delete(existing.date);
      }
      const targetDate = data.date ?? existing?.date;
      const targetKg = data.kg ?? existing?.kg;
      if (targetDate && targetKg != null) {
        invalidateFrom(targetDate);
        const currentSeries = seriesMap.get(targetDate);
        seriesMap.set(targetDate, {
          scaleKg: targetKg,
          trendKg: currentSeries ? currentSeries.trendKg : null
        });
        editableMap.set(op.recordId, {
          id: op.recordId,
          date: targetDate,
          kg: targetKg,
          context: data.context ?? existing?.context ?? null,
          revision: op.expectedRevision,
          deleted: false
        });
      }
    }
  }

  const series: ProgressWeightPoint[] = Array.from(seriesMap.entries())
    .filter(([date]) => date >= range.start && date <= range.end)
    .sort(([d1], [d2]) => d1.localeCompare(d2))
    .map(([date, val]) => ({ date, scaleKg: val.scaleKg, trendKg: affectedFrom && date >= affectedFrom ? null : val.trendKg }));

  const editableWeighIns = Array.from(editableMap.values())
    .filter(w => !w.deleted && w.date >= range.start && w.date <= range.end)
    .sort((a, b) => b.date.localeCompare(a.date));

  const scaleValues = series.map(p => p.scaleKg);
  const count = scaleValues.length;
  const stats: ProgressWeightStatistics = {
    count,
    averageKg: count > 0 ? scaleValues.reduce((s, v) => s + v, 0) / count : null,
    minimumKg: count > 0 ? Math.min(...scaleValues) : null,
    maximumKg: count > 0 ? Math.max(...scaleValues) : null,
    firstKg: scaleValues[0] ?? null,
    latestKg: scaleValues[scaleValues.length - 1] ?? null,
    latestTrendKg: null,
    trendChangeKg: null,
    trendPending: true
  };

  return {
    statistics: stats,
    series,
    editableWeighIns,
    historyUnavailable: base.historyUnavailable
  };
}

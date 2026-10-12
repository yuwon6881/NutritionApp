import type {EnergyUnit} from '../../types';
import {equalDistribution, normaliseDistribution, weekendDistribution} from '../../lib/dailyTargets';
import {displayEnergy, energyLabel} from '../../lib/units';

interface WeeklyScheduleReviewProps {
  weeklyValues: number[];
  shares?: number[] | null;
  energyUnit: EnergyUnit;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function getWeeklyScheduleSubtitle(values: number[], shares?: number[] | null): string {
  // Shares may be stored on any scale; compare them as percentages of the week, like the schedule step.
  const norm = normaliseDistribution(shares) ?? normaliseDistribution(values);
  if (norm) {
    const weekendShares = weekendDistribution();
    if (norm.every((s, i) => Math.abs(s - weekendShares[i]) < 0.2)) {
      return 'Higher on weekends';
    }
    const equalShares = equalDistribution();
    if (norm.every((s, i) => Math.abs(s - equalShares[i]) < 0.2)) {
      return 'Balanced daily targets';
    }
    return 'Custom schedule';
  }
  return 'Balanced daily targets';
}

export function WeeklyScheduleReview({
  weeklyValues,
  shares,
  energyUnit,
}: WeeklyScheduleReviewProps) {
  const subtitle = getWeeklyScheduleSubtitle(weeklyValues, shares);
  const sum = weeklyValues.reduce((total, v) => total + v, 0);
  const avg = Math.round(sum / (weeklyValues.length || 7));

  return (
    <div className="weekly-review-summary">
      <div className="weekly-summary-head">
        <strong>Daily calorie schedule</strong>
        <span className="weekly-summary-sub">{subtitle}</span>
      </div>
      <div className="weekly-chips-grid">
        {weeklyValues.map((value, index) => {
          const dayName = DAY_NAMES[index] ?? `Day ${index + 1}`;
          const diff = value - avg;
          const isBoosted = diff > 0;
          return (
            <div key={index} className={`weekly-day-chip ${isBoosted ? 'is-boosted' : ''}`}>
              <span className="weekly-day-name">{dayName}</span>
              <strong className="weekly-day-val">{displayEnergy(value, energyUnit)}</strong>
              {isBoosted && (
                <span className="weekly-chip-badge" aria-label={`+${displayEnergy(diff, energyUnit)} ${energyLabel(energyUnit)}`}>
                  +{displayEnergy(diff, energyUnit)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

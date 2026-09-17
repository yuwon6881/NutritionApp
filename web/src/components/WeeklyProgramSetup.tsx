import {useState, useMemo} from 'react';
import {allocateWeeklyCalories, adjustWeeklyCalories, equalDistribution, weekendDistribution, normaliseDistribution} from '../lib/dailyTargets';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {SegmentedControl} from './ui/SegmentedControl';
import {Lock, Unlock, Check} from 'lucide-react';
import type {EnergyUnit} from '../types';
import {displayEnergy, energyLabel, inputEnergy, parseEnergy} from '../lib/units';
import {Slider} from './ui/Slider';

const labels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
type DistributionMode = 'even' | 'weekend' | 'custom';

export function WeeklyProgramSetup({
  budget,
  values,
  energyUnit = 'kcal',
  custom = false,
  onChange,
}: {
  budget: number;
  values: number[];
  energyUnit?: EnergyUnit;
  custom?: boolean;
  onChange: (values: number[], isCustom?: boolean) => void;
}) {
  const target = Math.round(budget);
  const equal = useMemo(() => allocateWeeklyCalories(target, equalDistribution()), [target]);
  const weekend = useMemo(() => allocateWeeklyCalories(target, weekendDistribution()), [target]);

  const detectInitialMode = (): DistributionMode => {
    if (!custom) return 'even';
    if (values.length === 7) {
      const shares = normaliseDistribution(values);
      const weekendShares = weekendDistribution();
      if (shares && shares.every((s, i) => Math.abs(s - weekendShares[i]) < 0.2)) {
        return 'weekend';
      }
      const equalShares = equalDistribution();
      if (shares && shares.every((s, i) => Math.abs(s - equalShares[i]) < 0.2)) {
        return 'even';
      }
    }
    return 'custom';
  };

  const [mode, setMode] = useState<DistributionMode>(detectInitialMode);
  const [locked, setLocked] = useState<boolean[]>([false, false, false, false, false, false, false]);
  const sum = values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  const valid = values.length === 7 && values.every(value => Number.isInteger(value) && value >= 0) && sum === target;
  const remaining = target - sum;

  const unlockedCount = locked.filter(l => !l).length;

  const toggleLock = (index: number) => {
    if (!locked[index] && unlockedCount <= 2) {
      return;
    }
    setLocked(prev => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const unlockAll = () => {
    setLocked([false, false, false, false, false, false, false]);
  };

  const handleEqualize = () => {
    if (locked.every(l => !l)) {
      onChange(equal, true);
    } else {
      const unlocked = [0, 1, 2, 3, 4, 5, 6].filter(i => !locked[i]);
      const lockedSum = values.reduce((total, v, i) => locked[i] ? total + v : total, 0);
      const avail = Math.max(0, target - lockedSum);
      const shares = unlocked.map(() => 100 / unlocked.length);
      const allocated = allocateWeeklyCalories(avail, shares);
      const next = [...values];
      unlocked.forEach((idx, k) => { next[idx] = allocated[k]; });
      onChange(next, true);
    }
  };

  const handleWeekendBoost = () => {
    if (locked.every(l => !l)) {
      onChange(weekend, true);
    } else {
      const unlocked = [0, 1, 2, 3, 4, 5, 6].filter(i => !locked[i]);
      const lockedSum = values.reduce((total, v, i) => locked[i] ? total + v : total, 0);
      const avail = Math.max(0, target - lockedSum);
      const rawWeights = unlocked.map(i => (i >= 5 ? 1.5 : 1.0));
      const totalWeight = rawWeights.reduce((s, w) => s + w, 0);
      const shares = rawWeights.map(w => (w / totalWeight) * 100);
      const allocated = allocateWeeklyCalories(avail, shares);
      const next = [...values];
      unlocked.forEach((idx, k) => { next[idx] = allocated[k]; });
      onChange(next, true);
    }
  };

  const handleModeChange = (nextMode: DistributionMode) => {
    setMode(nextMode);
    if (nextMode === 'even') {
      onChange(equal, false);
    } else if (nextMode === 'weekend') {
      onChange(weekend, true);
    } else {
      onChange(values, true);
    }
  };

  // Fixed maxSlider based on target alone, completely independent of live values,
  // preventing any slider thumb/fill fluctuation when locked days remain untouched.
  const averageDaily = target / 7;
  const maxSlider = Math.min(target, Math.round(Math.max(3500, averageDaily * 2.5)));

  return (
    <section className="weekly-program" aria-labelledby="weekly-program-title">
      <div className="section-heading">
        <div>
          <h3 id="weekly-program-title">Weekly calorie distribution</h3>
          <p>Choose whether to distribute calories evenly, allocate more to weekends, or customize each day.</p>
        </div>
      </div>

      <SegmentedControl<DistributionMode>
        label="Distribution mode"
        value={mode}
        size="sm"
        options={[
          {value: 'even', label: 'Even distributed'},
          {value: 'weekend', label: 'Higher on weekends'},
          {value: 'custom', label: 'Custom'},
        ]}
        onChange={handleModeChange}
      />

      <div className={`weekly-program-total ${valid ? 'valid' : 'invalid'}`} role="status" aria-live="polite">
        <div className="weekly-total-budget">
          <span>Weekly budget</span>
          <strong>{displayEnergy(target, energyUnit)} {energyLabel(energyUnit)}</strong>
        </div>
        <div className="weekly-total-status">
          {valid ? (
            <span className="weekly-valid-badge">
              <Check size={14} aria-hidden="true" /> Exact budget
            </span>
          ) : (
            <span>
              Remaining {displayEnergy(Math.abs(remaining), energyUnit)} {energyLabel(energyUnit)}
              {remaining < 0 ? ' over' : ''}
            </span>
          )}
        </div>
      </div>

      {mode === 'even' && (
        <div className="weekly-coach-default-card">
          <p className="weekly-coach-default-desc">
            Your weekly budget of <strong>{displayEnergy(target, energyUnit)} {energyLabel(energyUnit)}</strong> is distributed evenly across all seven days.
          </p>
          <div className="weekly-preview-grid">
            {labels.map((label, index) => (
              <div key={label} className="weekly-preview-pill">
                <span className="weekly-preview-day">{label.slice(0, 3)}</span>
                <strong className="weekly-preview-val">{displayEnergy(equal[index], energyUnit)}</strong>
                <small>{energyLabel(energyUnit)}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'weekend' && (
        <div className="weekly-coach-default-card">
          <p className="weekly-coach-default-desc">
            Your weekly budget of <strong>{displayEnergy(target, energyUnit)} {energyLabel(energyUnit)}</strong> is weighted so weekdays have a lower target, reserving more calories for Saturday and Sunday.
          </p>
          <div className="weekly-preview-grid">
            {labels.map((label, index) => {
              const isWeekendDay = index >= 5;
              return (
                <div key={label} className={`weekly-preview-pill ${isWeekendDay ? 'is-weekend' : ''}`}>
                  <span className="weekly-preview-day">{label.slice(0, 3)}</span>
                  <strong className="weekly-preview-val">{displayEnergy(weekend[index], energyUnit)}</strong>
                  <small>{energyLabel(energyUnit)}</small>
                  {isWeekendDay && <span className="weekly-preview-badge">+50% boost</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'custom' && (
        <>
          <div className="weekly-custom-toolbar">
            <p className="source weekly-program-hint">
              {locked.some(Boolean)
                ? `${locked.filter(Boolean).length} day${locked.filter(Boolean).length > 1 ? 's' : ''} locked · Unlocked days adjust automatically to maintain your budget.`
                : 'Unlocked days adjust automatically as you slide or type to keep your weekly budget exact.'}
            </p>
            <div className="weekly-heading-actions">
              {locked.some(Boolean) && (
                <Button type="button" variant="tertiary" size="sm" onClick={unlockAll}>
                  Unlock all
                </Button>
              )}
              <Button type="button" variant="secondary" size="sm" onClick={handleEqualize}>
                Equal distribution
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={handleWeekendBoost}>
                Weekend boost
              </Button>
            </div>
          </div>

          <div className="weekly-rows" role="region" aria-label="Days of the week calories">
            {labels.map((label, index) => {
              const val = values[index] ?? 0;
              const isLocked = locked[index];
              const cannotLock = !isLocked && unlockedCount <= 2;
              const pct = target > 0 ? Math.round((val / target) * 1000) / 10 : 0;

              return (
                <div key={label} className={`weekly-row ${isLocked ? 'is-locked' : ''}`}>
                  <div className="weekly-row-head">
                    <span className="weekly-row-label">{label}</span>
                    <span className="weekly-row-share">
                      {isLocked && (
                        <span className="weekly-lock-badge" aria-label="Locked">
                          <Lock size={11} aria-hidden="true" /> Locked
                        </span>
                      )}
                      <strong className="weekly-row-percent">
                        {pct.toFixed(1)}%
                      </strong>
                    </span>
                  </div>

                  <div className="weekly-row-controls">
                    <Button
                      presentation="plain"
                      className={`weekly-lock-btn ${isLocked ? 'active' : ''}`}
                      disabled={cannotLock}
                      aria-pressed={isLocked}
                      aria-label={isLocked ? `Unlock ${label}` : `Lock ${label}`}
                      title={
                        cannotLock
                          ? 'At least two days must remain unlocked to balance the budget'
                          : isLocked
                            ? `Unlock ${label}`
                            : `Lock ${label} calories`
                      }
                      onClick={() => toggleLock(index)}
                    >
                      {isLocked ? <Lock size={15} aria-hidden="true" /> : <Unlock size={15} aria-hidden="true" />}
                    </Button>

                    <Slider
                      id={`weekly-range-${index}`}
                      name={`weeklyRange${index}`}
                      label={`${label} daily energy`}
                      showLabel={false}
                      className={`weekly-range ${isLocked ? 'locked' : ''}`}
                      min={0}
                      max={maxSlider}
                      step={5}
                      value={val}
                      disabled={isLocked}
                      ariaLabel={`${label} daily energy slider`}
                      formatValue={value => `${displayEnergy(value, energyUnit)} ${energyLabel(energyUnit)}`}
                      onChange={value => {
                        const next = adjustWeeklyCalories(values, target, index, value, locked);
                        onChange(next, true);
                      }}
                    />

                    <div className="weekly-number">
                      <Field
                        id={`weekly-calories-${index}`}
                        name={`weeklyCalories${index}`}
                        label={`${label} (${energyLabel(energyUnit)})`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={target}
                        step={1}
                        disabled={isLocked}
                        value={values[index] == null ? '' : inputEnergy(values[index], energyUnit, 0)}
                        aria-label={`${label} energy`}
                        onChange={event => {
                          const parsed = parseEnergy(event.target.value, energyUnit);
                          if (event.target.value && !isNaN(parsed) && parsed >= 0) {
                            const next = adjustWeeklyCalories(values, target, index, Math.round(parsed), locked);
                            onChange(next, true);
                          }
                        }}
                        onBlur={event => {
                          const parsed = parseEnergy(event.target.value, energyUnit);
                          if (event.target.value && !isNaN(parsed) && parsed >= 0) {
                            const next = adjustWeeklyCalories(values, target, index, Math.round(parsed), locked);
                            onChange(next, true);
                          } else {
                            onChange([...values], true);
                          }
                        }}
                      />
                      <span className="weekly-unit-label" aria-hidden="true">{energyLabel(energyUnit)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!valid && (
        <p className="error">
          Enter seven non-negative whole {energyLabel(energyUnit)} targets that total exactly{' '}
          {displayEnergy(target, energyUnit)} {energyLabel(energyUnit)}.
        </p>
      )}
    </section>
  );
}

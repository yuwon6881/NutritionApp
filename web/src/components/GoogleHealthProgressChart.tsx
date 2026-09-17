import {useState} from 'react';
import {number} from '../lib/format';
import {GoogleHealthDay, GoogleHealthFreshness, GoogleHealthStatus, calculateKnownDayAverage} from '../lib/googleHealth';
import {Footprints, ArrowUpRight} from 'lucide-react';
import {Button} from './ui/Button';

interface GoogleHealthProgressChartProps {
  days: GoogleHealthDay[];
  status: GoogleHealthStatus;
  freshness: GoogleHealthFreshness;
  loading?: boolean;
  onOpenSettings?: () => void;
}

export function GoogleHealthProgressChart({
  days,
  status,
  freshness,
  loading = false,
  onOpenSettings,
}: GoogleHealthProgressChartProps) {
  const [activeDay, setActiveDay] = useState<GoogleHealthDay | null>(null);

  if (status === 'disconnected') {
    return (
      <section className="panel google-health-progress-section" aria-labelledby="gh-progress-title">
        <div className="section-heading">
          <div className="title-with-icon">
            <Footprints size={20} className="panel-icon" aria-hidden="true" />
            <h2 id="gh-progress-title">Google Health steps · Last 30 days</h2>
          </div>
        </div>
        <p className="description">
          Track your daily step history alongside your nutrition progress.
        </p>
        {onOpenSettings && (
          <Button presentation="plain" className="inline-link" onClick={onOpenSettings}>
            Connect Google Health in Settings <ArrowUpRight size={13} aria-hidden="true" />
          </Button>
        )}
      </section>
    );
  }

  const average = calculateKnownDayAverage(days);
  const knownCount = days.filter(d => d.count !== null && d.count !== undefined).length;
  const hasRenderableHistory = knownCount > 0;

  // Compute SVG chart dimensions
  const chartHeight = 120;
  const barWidth = 7;
  const barGap = 3;
  const totalBars = Math.max(days.length, 1);
  const chartWidth = totalBars * (barWidth + barGap);

  const maxCount = Math.max(1000, ...days.map(d => d.count ?? 0));

  const formatShortDate = (dateStr: string) => {
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        return `${parts[1]}/${parts[2]}`;
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  return (
    <section className="panel google-health-progress-section" aria-labelledby="gh-progress-title">
      <div className="section-heading">
        <div className="title-with-icon">
          <Footprints size={20} className="panel-icon" aria-hidden="true" />
          <h2 id="gh-progress-title">Google Health steps · Last 30 days</h2>
        </div>
        {freshness === 'stale' && (
          <span className="freshness-badge stale" title="Step totals may be stale">
            Stale
          </span>
        )}
      </div>

      <div className="stats-grid google-health-stats">
        <div className="stat-card">
          <p className="eyebrow">KNOWN-DAY AVERAGE</p>
          <h2>
            {average !== null ? (
              <>
                <span className="tabular-num">{number(average)}</span>{' '}
                <span className="unit">steps / day</span>
              </>
            ) : (
              <>
                <span>—</span> <span className="unit">steps / day</span>
              </>
            )}
          </h2>
          <p className="source">
            {knownCount > 0
              ? `${knownCount} of ${days.length} days recorded · Missing days excluded`
              : 'No recorded steps in this period'}
          </p>
        </div>

        {activeDay && (
          <div className="stat-card active-day-preview">
            <p className="eyebrow">{activeDay.date}</p>
            <h2>
              {activeDay.count !== null ? (
                <>
                  <span className="tabular-num">{number(activeDay.count)}</span>{' '}
                  <span className="unit">steps</span>
                </>
              ) : (
                <>
                  <span>—</span> <span className="unit">not recorded</span>
                </>
              )}
            </h2>
            <p className="source">
              {activeDay.count !== null
                ? activeDay.count === 0
                  ? 'Zero steps recorded'
                  : 'Recorded total'
                : 'No activity data for this day'}
            </p>
          </div>
        )}
      </div>

      {loading && days.length === 0 ? (
        <div className="chart-skeleton" aria-busy="true">
          Loading step history…
        </div>
      ) : !hasRenderableHistory ? (
        <div className="chart-empty-state" role="status">
          {freshness === 'unavailable'
            ? 'Daily step history is unavailable right now.'
            : 'No daily step totals are available for this period.'}
        </div>
      ) : (
        <div className="step-chart-container">
          <svg
            className="step-bar-chart"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label={`Daily step counts over the last 30 days. Average is ${average !== null ? number(average) : 'unavailable'} steps per day.`}
          >
            {/* Horizontal guideline */}
            <line
              x1="0"
              y1={chartHeight - 1}
              x2={chartWidth}
              y2={chartHeight - 1}
              className="chart-baseline"
            />

            {days.map((day, idx) => {
              const x = idx * (barWidth + barGap);
              const count = day.count;
              const hasData = count !== null && count !== undefined;
              const height = hasData
                ? Math.max(count === 0 ? 1 : Math.round((count / maxCount) * (chartHeight - 15)), 2)
                : 0;
              const y = chartHeight - height - 1;
              const isSelected = activeDay?.date === day.date;

              if (!hasData) {
                // Render empty gap marker
                return (
                  <g key={day.date} className="bar-group gap-group">
                    <rect
                      x={x}
                      y={chartHeight - 6}
                      width={barWidth}
                      height={4}
                      rx={1}
                      className="bar-gap-marker"
                      tabIndex={0}
                      role="graphics-symbol"
                      aria-label={`${day.date}: No step data`}
                      onFocus={() => setActiveDay(day)}
                      onMouseEnter={() => setActiveDay(day)}
                    />
                  </g>
                );
              }

              return (
                <g key={day.date} className={`bar-group ${isSelected ? 'selected' : ''}`}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    rx={2}
                    className={`bar-rect ${count === 0 ? 'zero-bar' : ''}`}
                    tabIndex={0}
                    role="graphics-symbol"
                    aria-label={`${day.date}: ${number(count)} steps`}
                    onFocus={() => setActiveDay(day)}
                    onMouseEnter={() => setActiveDay(day)}
                  />
                </g>
              );
            })}
          </svg>

          {/* Date range axis labels */}
          {days.length > 0 && (
            <div className="chart-date-axis">
              <span>{formatShortDate(days[0].date)}</span>
              <span>{formatShortDate(days[Math.floor(days.length / 2)].date)}</span>
              <span>{formatShortDate(days[days.length - 1].date)}</span>
            </div>
          )}
        </div>
      )}

      {/* Screen-reader accessible step summary */}
      <div className="sr-only">
        <table>
          <caption>Daily step history for the last 30 days</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Steps</th>
            </tr>
          </thead>
          <tbody>
            {days.map(d => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{d.count !== null ? number(d.count) : 'Not recorded'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

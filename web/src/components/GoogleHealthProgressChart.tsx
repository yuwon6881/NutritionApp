import {useId} from 'react';
import {Footprints, ArrowUpRight} from 'lucide-react';
import {number} from '../lib/format';
import {GoogleHealthDay, GoogleHealthFreshness, GoogleHealthStatus, calculateKnownDayAverage} from '../lib/googleHealth';
import {niceTicks} from '../lib/barChart';
import {bucketAxisLabel, bucketReadoutLabel, dateSpan} from '../lib/chartLabels';
import {Button} from './ui/Button';
import {BAR_AXIS_WIDTH, BarChartFrame, BarChartNav} from './ui/BarChartFrame';
import {useBarViewport, useRevealBar} from './ui/useBarViewport';
import {useChartScrub} from './ui/useChartScrub';

interface GoogleHealthProgressChartProps {
  days: GoogleHealthDay[];
  status: GoogleHealthStatus;
  freshness: GoogleHealthFreshness;
  todayDate?: string;
  loading?: boolean;
  onOpenSettings?: () => void;
}

const HEIGHT = 196;
const TOP = 12;
const BASE = 154;
const LABEL_Y = 172;

const compactSteps = (value: number) => value >= 1000 ? `${number(value / 1000, 1)}k` : number(value);

export function GoogleHealthProgressChart({
  days,
  status,
  freshness,
  todayDate,
  loading = false,
  onOpenSettings,
}: GoogleHealthProgressChartProps) {
  const viewport = useBarViewport(days.length);
  const scrub = useChartScrub(days.map((_, index) => viewport.slot * (index + .5)), {tapToSelect: true});
  useRevealBar(viewport, scrub.index);
  const readoutId = useId();

  if (status === 'disconnected') {
    return (
      <section className="panel google-health-progress-section" aria-labelledby="gh-progress-title">
        <div className="section-heading">
          <div className="title-with-icon">
            <Footprints size={20} className="panel-icon" aria-hidden="true" />
            <h2 id="gh-progress-title">Google Health steps · Last 30 days</h2>
          </div>
        </div>
        {onOpenSettings && (
          <Button presentation="plain" className="inline-link" onClick={onOpenSettings}>
            Connect Google Health in Settings <ArrowUpRight size={13} aria-hidden="true" />
          </Button>
        )}
      </section>
    );
  }

  const completedDays = todayDate ? days.filter(d => d.date !== todayDate) : days;
  const average = calculateKnownDayAverage(completedDays);
  const knownCount = completedDays.filter(d => d.count !== null && d.count !== undefined).length;
  const hasRenderableHistory = days.some(d => d.count !== null && d.count !== undefined);
  const selected = days[scrub.index];
  const selectedCount = selected?.count ?? null;

  const ticks = niceTicks(0, Math.max(1000, ...days.map(d => d.count ?? 0)), 3);
  const ceiling = ticks.at(-1)!;
  const y = (value: number) => BASE - value / ceiling * (BASE - TOP);
  const {slot, contentWidth} = viewport;
  const bar = Math.max(6, Math.min(26, slot * .56));
  const axis = ticks.map(value => <text key={value} x={BAR_AXIS_WIDTH - 8} y={y(value) + 4} textAnchor="end">{compactSteps(value)}</text>);
  const visibleSpan = days.length ? dateSpan(days[viewport.edges.first]?.date ?? days[0].date, days[viewport.edges.last]?.date ?? days.at(-1)!.date) : '';

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
          <p className="eyebrow">AVERAGE</p>
          <h2>
            <span className="tabular-num">{average !== null ? number(average) : '—'}</span>{' '}
            <span className="unit">steps / day</span>
          </h2>
          <p className="source">
            {knownCount > 0
              ? `${knownCount} of ${completedDays.length} days`
              : 'No steps recorded'}
          </p>
        </div>
      </div>

      {loading && days.length === 0 ? (
        <div className="chart-skeleton" aria-busy="true">
          Loading…
        </div>
      ) : !hasRenderableHistory ? (
        <div className="chart-empty-state" role="status">
          {freshness === 'unavailable'
            ? 'Step history unavailable.'
            : 'No steps recorded.'}
        </div>
      ) : (
        <div className="chart-scrub step-chart" role="group" aria-label="Step chart. Tap a bar or use the left and right arrow keys to read a day." aria-describedby={readoutId} {...scrub.groupProps}>
          {/* The readout always holds a day, so selecting a bar never moves the chart. */}
          <div id={readoutId} className="chart-readout chart-readout-grid" aria-live="polite">
            <strong className="chart-readout-date">{selected ? bucketReadoutLabel(selected.date, selected.date, 'daily') : '—'}</strong>
            <dl>
              <div><dt>Steps</dt><dd>{selectedCount === null ? 'Not recorded' : <>{number(selectedCount)}{selected?.date === todayDate && <small> so far today</small>}</>}</dd></div>
              <div><dt>Vs average</dt><dd>{selectedCount === null || average === null || selected?.date === todayDate ? '—' : `${selectedCount >= average ? '+' : '−'}${number(Math.abs(selectedCount - average))}`}</dd></div>
            </dl>
          </div>
          <BarChartNav viewport={viewport} range={visibleSpan}/>
          <BarChartFrame viewport={viewport} height={HEIGHT} axis={axis} plotProps={scrub.svgProps} pager="days"
            label={`Daily step counts over the last 30 days. Average is ${average !== null ? number(average) : 'unavailable'} steps per day.`}>
            {ticks.map(value => <line key={value} className={value === 0 ? 'chart-baseline' : 'chart-grid'} x1={0} x2={contentWidth} y1={y(value)} y2={y(value)}/>)}
            {selected && <rect className="bar-slot-selected" x={scrub.index * slot + 1} y={TOP - 6} width={Math.max(0, slot - 2)} height={BASE - TOP + 10} rx={6}/>}
            {days.map((day, index) => {
              const x = slot * (index + .5) - bar / 2;
              const [weekday, date] = bucketAxisLabel(day.date, 'daily');
              const center = slot * (index + .5);
              const label = <text className={index === scrub.index ? 'bar-axis-label is-selected' : 'bar-axis-label'} x={center} y={LABEL_Y} textAnchor="middle"><tspan x={center}>{weekday}</tspan><tspan x={center} dy="14">{date}</tspan></text>;
              if (day.count === null || day.count === undefined) {
                return <g key={day.date}><rect className="bar-missing" x={x} y={BASE - 3} width={bar} height={3} rx={1.5}/>{label}</g>;
              }
              const top = y(day.count);
              return <g key={day.date}>
                <rect className={`bar-rect${day.count === 0 ? ' zero-bar' : ''}${day.date === todayDate ? ' partial-bar' : ''}`} x={x} y={Math.min(top, BASE - 2)} width={bar} height={Math.max(2, BASE - top)} rx={Math.min(4, bar / 3)}/>
                {label}
              </g>;
            })}
            {average !== null && <line className="average-line" x1={0} x2={contentWidth} y1={y(average)} y2={y(average)}/>}
          </BarChartFrame>
          <ul className="chart-legend" aria-label="Step chart key">
            <li><span className="legend-swatch swatch-steps" aria-hidden="true"/>Recorded steps</li>
            <li><span className="legend-swatch swatch-steps-partial" aria-hidden="true"/>Today so far</li>
            <li><span className="legend-line swatch-average" aria-hidden="true"/>Average</li>
            <li><span className="legend-swatch swatch-missing" aria-hidden="true"/>Not recorded</li>
          </ul>
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

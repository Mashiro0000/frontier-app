import { useEffect, useState } from 'react'
import {
  USAGE_RANGES,
  type DailyUsage,
  type UsageDay,
  type UsageRange
} from '../../../shared/usage'
import { formatCount, formatSpend, inputSide } from './format'

const RANGE_LABELS: Record<UsageRange, string> = { 7: '7 days', 30: '30 days', 90: '3 months' }
type Measure = 'cost' | 'tokens'

const tokensOf = (d: UsageDay): number => inputSide(d.tokens) + d.tokens.output
const valueOf = (d: UsageDay, measure: Measure): number =>
  measure === 'cost' ? d.costUsd : tokensOf(d)
const dayName = (ms: number, withWeekday = false): string =>
  new Date(ms).toLocaleDateString('en-US', {
    ...(withWeekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short'
  })

/** A round top for the scale: 1, 2 or 5 times a power of ten, at or above the highest bar. */
function niceTop(max: number): number {
  if (max <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 5, 10]) if (step * power >= max) return step * power
  return 10 * power
}

const W = 640
const H = 180
const LEFT = 52
const BOTTOM = 24
const TOP = 10

/**
 * (22.5, D-054) The usage chart, as AI Fiesta's Tokens Usage: what was used day by day for the last 7 days, 30 days or 3 months, in cost or in tokens (one at
 * a time: one scale), from main's own ledger (the page asks for sums and nothing else). One colour, so no legend; each bar says its day and amounts when
 * pointed at or focused; the same numbers are in a table under it for a screen reader.
 */
function UsageChart({ open }: { open: boolean }): React.JSX.Element {
  const [range, setRange] = useState<UsageRange>(30)
  const [measure, setMeasure] = useState<Measure>('cost')
  const [data, setData] = useState<{ range: UsageRange; usage: DailyUsage } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    window.api.usage
      .daily(range)
      .then((usage) => {
        if (!live) return
        setData({ range, usage })
        setError(null)
      })
      .catch((failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => {
      live = false
    }
  }, [open, range])

  const usage = data !== null && data.range === range ? data.usage : null
  const days = usage?.days ?? []
  const top = niceTop(Math.max(0, ...days.map((d) => valueOf(d, measure))))
  const slot = days.length > 0 ? (W - LEFT) / days.length : 0
  const gap = Math.max(2, Math.min(6, slot * 0.25))
  const bar = Math.max(2, slot - gap)
  const y = (v: number): number => TOP + (H - TOP - BOTTOM) * (1 - v / top)
  const label = (v: number): string => (measure === 'cost' ? formatSpend(v, false) : formatCount(v))
  // About five day names under the bars, never crowded.
  const every = Math.max(1, Math.ceil(days.length / 6))
  const shown = hover !== null ? days[hover] : undefined
  const anything = days.some((d) => d.requests > 0)

  return (
    <div className="usage-chart">
      <div className="usage-chart-tools">
        <div className="model-chooser-filters" role="group" aria-label="Range">
          {USAGE_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className="chip"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="theme-choice usage-measure" role="group" aria-label="Show">
          {(['cost', 'tokens'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="theme-option"
              aria-pressed={measure === m}
              onClick={() => setMeasure(m)}
            >
              {m === 'cost' ? 'Cost' : 'Tokens'}
            </button>
          ))}
        </div>
      </div>
      {error !== null && (
        <p className="settings-notice settings-notice-error" role="status">
          The chart could not be read: {error}
        </p>
      )}
      {usage === null ? (
        error === null && <p className="settings-status">Checking...</p>
      ) : (
        <>
          <p className="usage-chart-total" aria-live="polite">
            <strong>{formatSpend(usage.total.costUsd, usage.total.about)}</strong> in the last{' '}
            {RANGE_LABELS[range]}: {formatCount(inputSide(usage.total.tokens))} tokens in,{' '}
            {formatCount(usage.total.tokens.output)} out,{' '}
            {usage.total.requests === 1
              ? '1 request'
              : `${formatCount(usage.total.requests)} requests`}
            .
          </p>
          <div className="usage-chart-plot">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="usage-chart-svg"
              role="img"
              aria-label={`${measure === 'cost' ? 'Cost' : 'Tokens'} per day, the last ${RANGE_LABELS[range]}`}
              onMouseLeave={() => setHover(null)}
            >
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line className="usage-grid" x1={LEFT} x2={W} y1={y(top * f)} y2={y(top * f)} />
                  <text className="usage-axis" x={LEFT - 8} y={y(top * f) + 4} textAnchor="end">
                    {label(top * f)}
                  </text>
                </g>
              ))}
              {days.map((d, i) => {
                const v = valueOf(d, measure)
                const x = LEFT + i * slot + gap / 2
                const h = Math.max(v > 0 ? 2 : 0, y(0) - y(v))
                return (
                  <g key={d.start}>
                    {/* The target is the whole column, wider and taller than the bar. */}
                    <rect
                      className="usage-hit"
                      x={LEFT + i * slot}
                      y={TOP}
                      width={slot}
                      height={H - TOP - BOTTOM}
                      onMouseEnter={() => setHover(i)}
                    />
                    {h > 0 && (
                      <path
                        className={`usage-bar${hover === i ? ' usage-bar-on' : ''}`}
                        d={`M${x},${y(0)} v${-(h - Math.min(4, h))} q0,${-Math.min(4, h)} ${Math.min(4, bar / 2)},${-Math.min(4, h)} h${bar - 2 * Math.min(4, bar / 2)} q${Math.min(4, bar / 2)},0 ${Math.min(4, bar / 2)},${Math.min(4, h)} v${h - Math.min(4, h)} z`}
                      />
                    )}
                    {i % every === (days.length - 1) % every && (
                      <text
                        className="usage-axis"
                        x={LEFT + i * slot + slot / 2}
                        y={H - 6}
                        textAnchor="middle"
                      >
                        {dayName(d.start)}
                      </text>
                    )}
                  </g>
                )
              })}
              <line className="usage-baseline" x1={LEFT} x2={W} y1={y(0)} y2={y(0)} />
            </svg>
            {shown !== undefined && hover !== null && (
              <div
                className="usage-tip"
                role="status"
                style={{
                  left: `${((LEFT + hover * slot + slot / 2) / W) * 100}%`
                }}
              >
                <span className="usage-tip-day">{dayName(shown.start, true)}</span>
                <span>{formatSpend(shown.costUsd, shown.about)}</span>
                <span className="usage-tip-muted">
                  {formatCount(tokensOf(shown))} tokens,{' '}
                  {shown.requests === 1 ? '1 request' : `${shown.requests} requests`}
                </span>
              </div>
            )}
          </div>
          {!anything && (
            <p className="settings-hint">
              Nothing used in the last {RANGE_LABELS[range]}. The bars appear once you send a
              message.
            </p>
          )}
          {/* The same numbers as a table, for a screen reader (the bars are a picture). */}
          <table className="visually-hidden">
            <caption>Usage per day, the last {RANGE_LABELS[range]}</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Cost</th>
                <th scope="col">Tokens</th>
                <th scope="col">Requests</th>
              </tr>
            </thead>
            <tbody>
              {days
                .filter((d) => d.requests > 0)
                .map((d) => (
                  <tr key={d.start}>
                    <th scope="row">{dayName(d.start, true)}</th>
                    <td>{formatSpend(d.costUsd, d.about)}</td>
                    <td>{formatCount(tokensOf(d))}</td>
                    <td>{d.requests}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

export default UsageChart

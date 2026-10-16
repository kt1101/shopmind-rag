// Tiny scale/tick helpers for the plain-SVG admin charts. No dependencies.

export function linearScale([d0, d1], [r0, r1]) {
  const span = d1 - d0
  const fn = (value) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0))
  fn.domain = [d0, d1]
  fn.range = [r0, r1]
  return fn
}

// Rounds a raw step up to 1, 2, 2.5 or 5 x 10^n.
export function niceStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1
  const exponent = Math.floor(Math.log10(rawStep))
  const base = 10 ** exponent
  const fraction = rawStep / base
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * base
}

function roundTo(value, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  return Number(value.toFixed(decimals))
}

// Returns {min, max, step, ticks} covering [min, max] with about `count` nice ticks.
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1, ticks: [0, 1] }
  if (min > max) [min, max] = [max, min]
  if (min === max) {
    if (min === 0) return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] }
    const pad = Math.abs(min) * 0.1
    min -= pad
    max += pad
  }
  const step = niceStep((max - min) / Math.max(1, count - 1))
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks = []
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(roundTo(v, step))
  return { min: roundTo(niceMin, step), max: roundTo(niceMax, step), step, ticks }
}

// Domain helper for bar/line charts that should start at zero.
export function zeroBasedTicks(values, count = 5) {
  const finite = values.filter((v) => Number.isFinite(v))
  const max = finite.length ? Math.max(0, ...finite) : 0
  const min = finite.length ? Math.min(0, ...finite) : 0
  return niceTicks(min, max, count)
}

// Evenly spaced bands for categorical x axes.
export function bandScale(keys, [r0, r1], padding = 0.2) {
  const n = keys.length
  const step = n > 0 ? (r1 - r0) / n : 0
  const bandwidth = step * (1 - padding)
  const index = new Map(keys.map((k, i) => [k, i]))
  const fn = (key) => r0 + (index.get(key) ?? 0) * step + (step - bandwidth) / 2
  fn.bandwidth = bandwidth
  fn.step = step
  return fn
}

export function formatTick(value) {
  if (!Number.isFinite(value)) return ''
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${Number((value / 1e6).toFixed(1))}M`
  if (abs >= 1e3) return `${Number((value / 1e3).toFixed(1))}k`
  if (abs > 0 && abs < 1) return String(Number(value.toFixed(3)))
  return String(Number(value.toFixed(2)))
}

// Picks at most `max` evenly spaced indexes for x-axis labels (always includes first and last).
export function labelIndexes(length, max = 7) {
  if (length <= max) return Array.from({ length }, (_, i) => i)
  const out = new Set([0, length - 1])
  const step = (length - 1) / (max - 1)
  for (let i = 1; i < max - 1; i += 1) out.add(Math.round(i * step))
  return [...out].sort((a, b) => a - b)
}

export function linePath(points) {
  return points
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
}

// Bar path with 4px rounded data-end (top) and a square baseline.
export function barPath(x, y, width, height, radius = 4) {
  if (height <= 0 || width <= 0) return ''
  const r = Math.min(radius, width / 2, height)
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`
}

export const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']

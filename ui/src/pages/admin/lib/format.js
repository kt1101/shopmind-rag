// Display formatting shared by admin pages.

// Landis & Koch (1977) bands for Cohen's kappa.
const KAPPA_BANDS = [
  [0, 'Poor', 'bad'],
  [0.2, 'Slight', 'bad'],
  [0.4, 'Fair', 'warn'],
  [0.6, 'Moderate', 'warn'],
  [0.8, 'Substantial', 'good'],
  [1.0000001, 'Almost perfect', 'good'],
]

export function formatKappa(kappa, pairs) {
  if (kappa == null || !Number.isFinite(Number(kappa))) {
    return { value: '—', label: 'Not enough overlap', tone: 'neutral', detail: pairs ? `${pairs} paired judgments` : 'Need judgments from 2 annotators on the same items' }
  }
  const k = Math.max(-1, Math.min(1, Number(kappa)))
  let label = 'Poor'
  let tone = 'bad'
  if (k >= 0) {
    for (const [upper, name, bandTone] of KAPPA_BANDS) {
      if (k <= upper) {
        label = name
        tone = bandTone
        break
      }
    }
  }
  const detail = pairs != null ? `${pairs} paired judgment${pairs === 1 ? '' : 's'}` : ''
  return { value: k.toFixed(2), label, tone, detail }
}

export function formatPercent(rate, digits = 1) {
  if (rate == null || !Number.isFinite(Number(rate))) return '—'
  return `${(Number(rate) * 100).toFixed(digits)}%`
}

export function formatCount(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-US')
}

export function formatMs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—'
  const v = Number(ms)
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(v < 10 ? 1 : 0)} ms`
}

// "YYYY-MM-DD HH:mm" in the viewer's local time (the API sends UTC ISO timestamps).
export function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatMetric(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return Number(value).toFixed(3)
}

export function formatDelta(value, base) {
  if (!Number.isFinite(Number(value)) || !Number.isFinite(Number(base))) return { text: '—', sign: 0 }
  const delta = Number(value) - Number(base)
  const sign = Math.abs(delta) < 5e-4 ? 0 : delta > 0 ? 1 : -1
  return { text: `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(3)}`, sign }
}

// 👍 rate from stats totals.
export function positiveRate(totals) {
  const pos = Number(totals?.feedback_positive) || 0
  const neg = Number(totals?.feedback_negative) || 0
  return pos + neg === 0 ? null : pos / (pos + neg)
}

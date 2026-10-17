import { useState } from 'react'
import { timeTicks, waterfall } from '../../entities/trace/traceModel.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'

const STEP_COLORS = {
  query_understanding: 'var(--viz-series-8)',
  rewrite: 'var(--viz-series-8)',
  route_intent: 'var(--viz-series-8)',
  retrieve: 'var(--viz-series-1)',
  multi_source_retrieve: 'var(--viz-series-1)',
  compose_query: 'var(--viz-series-5)',
  filter: 'var(--viz-series-7)',
  fuse: 'var(--viz-series-3)',
  rerank: 'var(--viz-series-2)',
  build_context: 'var(--viz-series-7)',
  generate: 'var(--viz-series-4)',
  validate_citations: 'var(--viz-series-6)',
}

export function stepColor(step) {
  return STEP_COLORS[step] || 'var(--viz-series-8)'
}

export function formatMs(value) {
  if (!Number.isFinite(value)) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`
}

export function formatScore(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}

// Gantt-style waterfall: one row per step, bar offset = started_ms, width = duration_ms.
export function Waterfall({ trace }) {
  const { t } = useI18n()
  const { total, rows } = waterfall(trace)
  if (!rows.length) return <p className="sm-muted">{t('inspector.empty')}</p>
  const ticks = timeTicks(total)
  return (
    <figure className="insp-waterfall" aria-label={t('inspector.waterfall')}>
      <div className="insp-wf-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ left: `${total ? (tick / total) * 100 : 0}%` }}>{formatMs(tick)}</span>
        ))}
      </div>
      <ol className="insp-wf-rows">
        {rows.map((row) => (
          <li key={row.key} className="insp-wf-row">
            <span className="insp-wf-label">
              <strong>{row.id}</strong>
              <span className="sm-muted">{row.step}{row.impl ? ` · ${row.impl}` : ''}</span>
            </span>
            <span className="insp-wf-track">
              {ticks.map((tick) => <i key={tick} className="insp-wf-grid" style={{ left: `${total ? (tick / total) * 100 : 0}%` }} aria-hidden="true" />)}
              <span
                className="insp-wf-bar"
                style={{ left: `${row.offsetPct}%`, width: `${row.widthPct}%`, background: stepColor(row.step) }}
                title={`${row.id}: ${formatMs(row.start)} → ${formatMs(row.end)}${row.summary ? ` · ${row.summary}` : ''}`}
              />
            </span>
            <span className="insp-wf-ms">{formatMs(row.duration)}</span>
            {row.summary && <span className="insp-wf-summary sm-muted">{row.summary}</span>}
          </li>
        ))}
      </ol>
      <figcaption className="sm-muted sm-small">{t('inspector.duration')}: {formatMs(total)}</figcaption>
    </figure>
  )
}

export function JsonBlock({ value, label }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="insp-json">
      <button type="button" className="sm-button sm-button--small insp-json-copy" onClick={copy}>{copied ? t('inspector.copied') : t('inspector.copy')}</button>
      <pre className="sm-code" aria-label={label} tabIndex={0}><code>{text}</code></pre>
    </div>
  )
}

export function StepTimeline({ trace }) {
  return <Waterfall trace={trace} />
}

import { useEffect, useId, useRef, useState } from 'react'
import { SERIES_COLORS } from './scale.js'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

export function useElementWidth(fallback = 600) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width) || fallback))
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [fallback])
  return [ref, width]
}

export function Legend({ series }) {
  if (!series || series.length < 2) return null
  return (
    <ul className="adm-legend">
      {series.map((s, i) => (
        <li key={s.name}>
          <span className="adm-legend-swatch" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} aria-hidden="true" />
          {s.name}
        </li>
      ))}
    </ul>
  )
}

// Accessible wrapper: <svg role="img"> labelled by title/desc + a data table fallback.
export function ChartFrame({ title, description, series, table, children, tooltip }) {
  const id = useId()
  const { t } = useI18n()
  return (
    <figure className="adm-chart">
      <Legend series={series} />
      <div className="adm-chart-plot">
        {children({ titleId: `${id}-t`, descId: `${id}-d`, title, description })}
        {tooltip}
      </div>
      {table && (
        <details className="adm-chart-table">
          <summary>{t('adm.showTable')}</summary>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <caption className="adm-sr-only">{title}</caption>
              <thead>
                <tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r}>{row.map((cell, c) => (c === 0 ? <th key={c} scope="row">{cell}</th> : <td key={c}>{cell}</td>))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  )
}

export function SvgTitle({ titleId, descId, title, description }) {
  return (
    <>
      <title id={titleId}>{title}</title>
      {description && <desc id={descId}>{description}</desc>}
    </>
  )
}

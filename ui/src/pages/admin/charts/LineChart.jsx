import { useState } from 'react'
import { ChartFrame, SvgTitle, useElementWidth } from './ChartFrame.jsx'
import { SERIES_COLORS, formatTick, labelIndexes, linePath, linearScale, zeroBasedTicks } from './scale.js'

const MARGIN = { top: 12, right: 16, bottom: 28, left: 44 }

// labels: x labels (e.g. dates). series: [{name, values:[number]}] (max 4).
export default function LineChart({ title, description, labels, series, height = 220, formatValue = formatTick }) {
  const [ref, width] = useElementWidth()
  const [hover, setHover] = useState(null)
  const innerW = width - MARGIN.left - MARGIN.right
  const innerH = height - MARGIN.top - MARGIN.bottom
  const all = series.flatMap((s) => s.values)
  const ticks = zeroBasedTicks(all, 5)
  const x = linearScale([0, Math.max(1, labels.length - 1)], [0, innerW])
  const y = linearScale([ticks.min, ticks.max], [innerH, 0])
  const xLabels = labelIndexes(labels.length, Math.max(2, Math.floor(innerW / 80)))

  function onMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left - MARGIN.left
    const idx = Math.round((px / innerW) * (labels.length - 1))
    setHover(Math.max(0, Math.min(labels.length - 1, idx)))
  }

  const table = {
    columns: ['Label', ...series.map((s) => s.name)],
    rows: labels.map((label, i) => [label, ...series.map((s) => formatValue(s.values[i]))]),
  }

  const tooltip = hover != null && (
    <div className="adm-tooltip" style={{ left: Math.min(width - 150, Math.max(0, MARGIN.left + x(hover) + 10)), top: MARGIN.top }}>
      <strong>{labels[hover]}</strong>
      {series.map((s, i) => (
        <div key={s.name} className="adm-tooltip-row">
          <span className="adm-legend-swatch" style={{ background: SERIES_COLORS[i] }} aria-hidden="true" />
          <span>{s.name}</span>
          <span className="adm-tooltip-value">{formatValue(s.values[hover])}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div ref={ref}>
      <ChartFrame title={title} description={description} series={series} table={table} tooltip={tooltip}>
        {(a11y) => (
          <svg
            width={width}
            height={height}
            role="img"
            aria-labelledby={a11y.titleId}
            aria-describedby={description ? a11y.descId : undefined}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <SvgTitle {...a11y} />
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {ticks.ticks.map((t) => (
                <g key={t} transform={`translate(0,${y(t)})`}>
                  <line x1={0} x2={innerW} className="adm-grid" />
                  <text x={-8} dy="0.32em" textAnchor="end" className="adm-axis-label">{formatTick(t)}</text>
                </g>
              ))}
              {xLabels.map((i) => (
                <text key={i} x={x(i)} y={innerH + 18} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'} className="adm-axis-label">
                  {labels[i]}
                </text>
              ))}
              {series.map((s, si) => (
                <path key={s.name} d={linePath(s.values.map((v, i) => [x(i), y(v)]))} fill="none" stroke={SERIES_COLORS[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {hover != null && (
                <g>
                  <line x1={x(hover)} x2={x(hover)} y1={0} y2={innerH} className="adm-crosshair" />
                  {series.map((s, si) => Number.isFinite(s.values[hover]) && (
                    <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={4.5} fill={SERIES_COLORS[si]} className="adm-marker" />
                  ))}
                </g>
              )}
            </g>
          </svg>
        )}
      </ChartFrame>
    </div>
  )
}

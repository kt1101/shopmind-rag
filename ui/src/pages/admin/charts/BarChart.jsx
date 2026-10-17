import { useState } from 'react'
import { ChartFrame, SvgTitle, useElementWidth } from './ChartFrame.jsx'
import { SERIES_COLORS, bandScale, barPath, formatTick, linearScale, zeroBasedTicks } from './scale.js'

const MARGIN = { top: 12, right: 12, bottom: 40, left: 48 }
const GAP = 2

// Grouped vertical bars. categories: x groups; series: [{name, values:[number|null]}] (max 4).
export default function BarChart({ title, description, categories, series, height = 240, formatValue = formatTick, unit = '' }) {
  const [ref, width] = useElementWidth()
  const [hover, setHover] = useState(null)
  const innerW = width - MARGIN.left - MARGIN.right
  const rotate = innerW / Math.max(1, categories.length) < 72
  const longest = Math.max(0, ...categories.map((c) => String(c).length))
  const bottom = rotate ? Math.min(96, 20 + longest * 3.6) : MARGIN.bottom
  const innerH = height - MARGIN.top - bottom
  const ticks = zeroBasedTicks(series.flatMap((s) => s.values), 5)
  const y = linearScale([ticks.min, ticks.max], [innerH, 0])
  const x = bandScale(categories, [0, innerW], 0.28)
  const barW = Math.max(2, (x.bandwidth - GAP * (series.length - 1)) / Math.max(1, series.length))

  const table = {
    columns: ['Category', ...series.map((s) => s.name)],
    rows: categories.map((c, ci) => [c, ...series.map((s) => (s.values[ci] == null ? '—' : `${formatValue(s.values[ci])}${unit}`))]),
  }

  const tooltip = hover && (
    <div className="adm-tooltip" style={{ left: Math.min(width - 160, Math.max(0, hover.left)), top: Math.max(0, hover.top - 52) }}>
      <strong>{categories[hover.ci]}</strong>
      <div className="adm-tooltip-row">
        <span className="adm-legend-swatch" style={{ background: SERIES_COLORS[hover.si] }} aria-hidden="true" />
        <span>{series[hover.si].name}</span>
        <span className="adm-tooltip-value">{formatValue(series[hover.si].values[hover.ci])}{unit}</span>
      </div>
    </div>
  )

  return (
    <div ref={ref}>
      <ChartFrame title={title} description={description} series={series} table={table} tooltip={tooltip}>
        {(a11y) => (
          <svg width={width} height={height} role="img" aria-labelledby={a11y.titleId} aria-describedby={description ? a11y.descId : undefined} onMouseLeave={() => setHover(null)}>
            <SvgTitle {...a11y} />
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {ticks.ticks.map((t) => (
                <g key={t} transform={`translate(0,${y(t)})`}>
                  <line x1={0} x2={innerW} className="adm-grid" />
                  <text x={-8} dy="0.32em" textAnchor="end" className="adm-axis-label">{formatTick(t)}</text>
                </g>
              ))}
              {categories.map((c, ci) => (
                <g key={c} transform={`translate(${x(c)},0)`}>
                  {series.map((s, si) => {
                    const v = s.values[ci]
                    if (v == null || !Number.isFinite(v)) return null
                    const bx = si * (barW + GAP)
                    const by = y(Math.max(0, v))
                    const bh = Math.abs(y(v) - y(0))
                    const active = hover && hover.ci === ci && hover.si === si
                    return (
                      <g key={s.name}>
                        <path d={barPath(bx, by, barW, bh)} fill={SERIES_COLORS[si]} opacity={hover && !active ? 0.55 : 1} />
                        <rect
                          x={bx - 1} y={0} width={barW + 2} height={innerH} fill="transparent"
                          onMouseEnter={() => setHover({ ci, si, left: MARGIN.left + x(c) + bx + barW + 6, top: MARGIN.top + by })}
                        >
                          <title>{`${c} · ${s.name}: ${formatValue(v)}${unit}`}</title>
                        </rect>
                      </g>
                    )
                  })}
                  <text
                    x={x.bandwidth / 2}
                    y={innerH + 16}
                    textAnchor={rotate ? 'end' : 'middle'}
                    transform={rotate ? `rotate(-28 ${x.bandwidth / 2} ${innerH + 16})` : undefined}
                    className="adm-axis-label"
                  >
                    {c}
                  </text>
                </g>
              ))}
              <line x1={0} x2={innerW} y1={y(0)} y2={y(0)} className="adm-baseline" />
            </g>
          </svg>
        )}
      </ChartFrame>
    </div>
  )
}

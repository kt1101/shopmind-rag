import { rankMovementLayout } from '../../entities/trace/searchTrace.js'

const SERIES = Array.from({ length: 8 }, (_, i) => `var(--viz-series-${i + 1})`)

export function columnLabel(column, t) {
  if (column.kind === 'fuse') return t('inspector.fused')
  if (column.kind === 'final') return t('inspector.final')
  return column.impl ? `${column.id} (${column.impl})` : column.id
}

// "Rank movement" slope chart: x = pipeline stage, y = rank (1 at the top).
export default function RankMovementChart({ table, selectedId, onSelect, t, maxRows = 10 }) {
  const layout = rankMovementLayout(table, { width: 680, height: 340, maxRows })
  if (!layout.lines.length || layout.columns.length < 2) return null
  const outsideLabel = '> top'
  return (
    <svg
      className="insp-movement"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`${t('inspector.movement')}: ${layout.lines.length} / ${layout.columns.map((c) => columnLabel(c, t)).join(' → ')}`}
    >
      {layout.ticks.map((tick) => (
        <g key={tick.rank}>
          <line x1={layout.columns[0].x - 10} x2={layout.columns.at(-1).x + 10} y1={tick.y} y2={tick.y} className="insp-mv-grid" />
          <text x={layout.columns[0].x - 16} y={tick.y + 4} textAnchor="end" className="insp-mv-tick">#{tick.rank}</text>
        </g>
      ))}
      <text x={layout.columns[0].x - 16} y={layout.outsideY + 4} textAnchor="end" className="insp-mv-tick">{outsideLabel}</text>
      <line x1={layout.columns[0].x - 10} x2={layout.columns.at(-1).x + 10} y1={layout.outsideY} y2={layout.outsideY} className="insp-mv-grid insp-mv-outside" />
      {layout.columns.map((column) => (
        <g key={column.id}>
          <line x1={column.x} x2={column.x} y1={18} y2={layout.outsideY} className="insp-mv-axis" />
          <text x={column.x} y={12} textAnchor="middle" className="insp-mv-col">{columnLabel(column, t)}</text>
        </g>
      ))}
      {layout.lines.map((line, index) => {
        const color = SERIES[index % SERIES.length]
        const selected = selectedId === line.id
        const dimmed = selectedId && !selected
        const segments = []
        for (let i = 1; i < line.points.length; i += 1) {
          const a = line.points[i - 1]
          const b = line.points[i]
          segments.push(
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={color}
              strokeWidth={selected ? 3.5 : 2}
              strokeDasharray={a.outside || b.outside ? '4 4' : undefined}
              strokeLinecap="round"
            />,
          )
        }
        return (
          <g key={line.id} className={`insp-mv-line ${dimmed ? 'is-dimmed' : ''}`} onClick={() => onSelect?.(line.id)}>
            <title>{line.title}</title>
            {segments}
            {line.points.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={selected ? 9 : 7} fill={p.outside ? 'var(--color-surface)' : color} stroke={color} strokeWidth="2" />
                {!p.outside && <text x={p.x} y={p.y + 3.5} textAnchor="middle" className="insp-mv-rank">{p.rank}</text>}
              </g>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

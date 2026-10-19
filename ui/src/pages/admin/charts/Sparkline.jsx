import { linePath, linearScale } from './scale.js'

// Decorative trend line for KPI tiles; the label carries the meaning for screen readers.
export default function Sparkline({ values = [], width = 96, height = 28, label }) {
  const finite = values.filter(Number.isFinite)
  if (finite.length < 2) return null
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const x = linearScale([0, values.length - 1], [2, width - 2])
  const y = linearScale([min, max], [height - 3, 3])
  const last = values[values.length - 1]
  return (
    <svg width={width} height={height} className="adm-sparkline" role="img" aria-label={label || `${finite.length} · ${last}`}>
      <path d={linePath(values.map((v, i) => [x(i), y(v)]))} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2.5} fill="var(--chart-1)" />
    </svg>
  )
}
